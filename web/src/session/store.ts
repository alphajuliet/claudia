const KEY = "claudia.token";

// Storage can be blocked (private windows, strict settings). Then the session lasts until the tab closes.
export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(KEY, token); } catch { /* kept in memory only */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  },
};
