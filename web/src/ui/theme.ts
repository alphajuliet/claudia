import { useState } from "react";

export type Theme = "system" | "light" | "dark";

export const THEME_CHOICES: { id: Theme; name: string }[] = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

const KEY = "claudia.theme";

/** The page background of each theme (`--bg` in styles.css), for the browser's and the status bar's colour. */
export const THEME_COLOURS = { light: "#ffffff", dark: "#1b1c1f" } as const;

/** Points the `theme-color` metas at the theme: both at its colour, or for System each at its own scheme's. */
function applyThemeColour(theme: Theme) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.media.includes("dark") ? THEME_COLOURS.dark : THEME_COLOURS.light;
    meta.content = theme === "system" ? own : THEME_COLOURS[theme];
  }
}

/** The theme saved in this browser; System when none is saved or storage is blocked. */
export function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

/**
 * Shows the theme at once (light or dark as `data-theme` on <html>; System removes it, so the stylesheet follows
 * the system) and saves it in this browser. `index.html` applies the saved one before the first paint.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  applyThemeColour(theme);
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch { /* shown, but only until the page reloads */ }
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(savedTheme);
  return [theme, (next) => {
    applyTheme(next);
    setTheme(next);
  }];
}
