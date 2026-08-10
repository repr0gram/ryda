export const THEME_STORAGE_KEY = "ryda-theme";

export type ThemePreference = "light" | "dark" | "system";

/**
 * Runs before first paint to stamp `data-theme` on <html>, so a stored
 * preference never flashes the wrong theme. Kept as a string because it has to
 * be inlined into the document head ahead of hydration.
 *
 * "system" deliberately removes the attribute rather than resolving it here —
 * globals.css already handles the unset case via prefers-color-scheme, and
 * leaving it unset keeps the OS listener live without any JS.
 */
export const themeInitScript = `
(function () {
  var t;
  try {
    // ?theme=light|dark pins the theme for this load without persisting it.
    // Makes themed links shareable and lets the screenshot harness capture
    // both modes without driving localStorage.
    t = new URLSearchParams(location.search).get("theme");
    if (t !== "light" && t !== "dark") {
      t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    }
  } catch (e) {}
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
  }
})();
`.trim();
