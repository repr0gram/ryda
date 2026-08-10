"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; glyph: string }[] = [
  { value: "light", label: "Light", glyph: "☀" },
  { value: "system", label: "System", glyph: "◐" },
  { value: "dark", label: "Dark", glyph: "☾" },
];

function apply(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("system");

  // Read the stored preference after mount. The inline script already applied
  // it to the DOM; this only syncs React's copy so the control shows the right
  // segment as active.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setPref(stored);
    } catch {
      // localStorage unavailable (private mode, embedded webview) — system it is.
    }
  }, []);

  function select(next: ThemePreference) {
    setPref(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference just won't persist across reloads.
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-surface-2 p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = pref === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => select(opt.value)}
            className={[
              "grid h-7 w-7 place-items-center rounded-md text-[13px] leading-none transition-colors",
              active
                ? "bg-surface-1 text-ink shadow-[var(--shadow-card)]"
                : "text-ink-muted hover:text-ink-secondary",
            ].join(" ")}
          >
            <span aria-hidden>{opt.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
