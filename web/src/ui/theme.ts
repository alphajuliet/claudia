import { useState } from "react";

export type Theme = "system" | "light" | "dark";

export const THEME_CHOICES: { id: Theme; name: string }[] = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

const KEY = "claudia.theme";

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
