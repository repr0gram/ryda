import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type RiderSettings,
} from "@/lib/rider-settings";
import type { RiderSettingsResponse } from "@/app/api/rider-settings/route";

/**
 * Keep the rider's numbers on the server as well as in this browser.
 *
 * The app stays local-first — it works signed out, and localStorage remains the
 * copy every screen reads — but the server needs these to compute estimated
 * power for a client that has no physics of its own.
 *
 * Failures are swallowed on purpose. Saving your weight must not fail because
 * the network is down, and the next save or the next sync carries it up.
 */
export async function pushSettings(settings: RiderSettings): Promise<void> {
  try {
    await fetch("/api/rider-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
  } catch {
    // Offline, or signed out. Either way this is not worth interrupting a save.
  }
}

/**
 * Reconcile this browser's settings with the account's, once, at sign-in.
 *
 * Order matters and is not symmetric. If the server has nothing, this browser's
 * settings are the only real ones and go up — skipping that step is what leaves
 * an existing user's estimates silently falling back to a 75 kg stranger on
 * their phone. If the server has something, it wins, because it is the copy
 * every device shares and the one the server computed stored metrics with.
 *
 * The exception is a server row nobody ever filled in: `configured: false` means
 * defaults were written by some earlier client, and real local settings beat it.
 */
export async function reconcileSettings(): Promise<RiderSettings> {
  const local = loadSettings();

  let remote: RiderSettingsResponse | null = null;
  try {
    const res = await fetch("/api/rider-settings");
    if (res.ok) remote = (await res.json()) as RiderSettingsResponse;
  } catch {
    return local;
  }
  if (!remote) return local;

  const serverHasReal = remote.source === "saved" && remote.settings.configured;
  if (serverHasReal) {
    saveSettings(remote.settings);
    return remote.settings;
  }

  if (local.configured) {
    await pushSettings(local);
    return local;
  }

  // Neither side has been filled in. Nothing to reconcile, and writing defaults
  // to the server would only make them look deliberate.
  return DEFAULT_SETTINGS;
}
