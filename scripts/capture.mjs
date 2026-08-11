#!/usr/bin/env node
/**
 * Screenshot + inspect a route by driving Chrome over the DevTools protocol.
 *
 * The plain `--screenshot` CLI flag can't tell you WHY a canvas came out blank,
 * and it can't wait on an app-level condition. This can: it evaluates JS in the
 * page, so a WebGL map can be asked whether it actually finished loading before
 * the shutter fires.
 *
 *   node scripts/capture.mjs /ride --theme dark --wait mapIdle --out out/ride.png
 *   node scripts/capture.mjs /ride --eval "document.title"
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CHROME =
  process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT ?? 9333);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const route = process.argv[2] ?? "/";
const theme = arg("theme", "dark");
const width = Number(arg("width", 1500));
const height = Number(arg("height", 1600));
const out = arg("out", `out/capture-${theme}.png`);
const waitFor = arg("wait", null);
const evalExpr = arg("eval", null);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const url = `${base}${route}${route.includes("?") ? "&" : "?"}theme=${theme}`;

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-first-run",
    "--user-data-dir=/tmp/ryda-cdp-profile",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("Chrome did not expose a debugging endpoint");
}

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #sessionId = null;
  /** Everything the page complained about, so failures explain themselves. */
  diagnostics = [];

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      switch (msg.method) {
        case "Runtime.consoleAPICalled": {
          if (!["error", "warning"].includes(msg.params.type)) break;
          const text = msg.params.args
            .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
            .join(" ");
          this.diagnostics.push(`console.${msg.params.type}: ${text}`);
          break;
        }
        case "Runtime.exceptionThrown": {
          const d = msg.params.exceptionDetails;
          this.diagnostics.push(
            `exception: ${d.exception?.description ?? d.text}`.split("\n")[0],
          );
          break;
        }
        case "Log.entryAdded": {
          if (msg.params.entry.level === "error") {
            this.diagnostics.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
          }
          break;
        }
        case "Network.loadingFailed": {
          this.diagnostics.push(
            `net failed: ${msg.params.errorText} (${msg.params.type})`,
          );
          break;
        }
      }
    });
  }

  setSession(id) {
    this.#sessionId = id;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    const payload = { id, method, params };
    if (this.#sessionId) payload.sessionId = this.#sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? "eval failed");
    }
    return res.result.value;
  }
}

/** Named app-level readiness conditions. */
const WAITS = {
  // MapLibre stashes its instance on window for exactly this purpose.
  mapIdle: `!!(window.__rydaMap && window.__rydaMap.loaded() && window.__rydaMap.areTilesLoaded())`,
  charts: `document.querySelectorAll('.uplot').length > 0`,
};

async function main() {
  const wsUrl = await browserSocket();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));

  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.setSession(sessionId);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send("Page.navigate", { url });
  await sleep(1500);

  // Drive a real file through the real <input type="file">, so the import path
  // is verified end to end rather than by calling the parser directly.
  const upload = arg("upload", null);
  if (upload) {
    await cdp.send("DOM.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });
    if (!nodeId) throw new Error("no file input found on the page");
    // Comma-separated so a whole library can be pushed through the real input.
    const files = upload.split(",").map((f) => resolve(f.trim()));
    await cdp.send("DOM.setFileInputFiles", { nodeId, files });
    console.log(`uploaded ${files.length} file(s)`);
    await sleep(Number(arg("uploadWait", 3000)));
  }

  if (waitFor) {
    const expr = WAITS[waitFor] ?? waitFor;
    let ok = false;
    for (let i = 0; i < 80; i++) {
      try {
        if (await cdp.evaluate(expr)) {
          ok = true;
          break;
        }
      } catch {
        /* page still initialising */
      }
      await sleep(250);
    }
    console.log(`wait(${waitFor}): ${ok ? "satisfied" : "TIMED OUT"}`);
    if (!ok) process.exitCode = 2;
    await sleep(600); // let the last frame paint
  }

  if (evalExpr) {
    console.log(JSON.stringify(await cdp.evaluate(evalExpr), null, 2));
  }

  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(data, "base64"));
  console.log(`wrote ${out}`);

  if (cdp.diagnostics.length) {
    console.log(`\n--- page diagnostics (${cdp.diagnostics.length}) ---`);
    for (const d of [...new Set(cdp.diagnostics)].slice(0, 25)) console.log(d);
  }

  ws.close();
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
