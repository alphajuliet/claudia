import { useSyncExternalStore } from "react";

const KEY = "claudia.showCompleted";
const listeners = new Set<() => void>();

const read = () => {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
};
let shown: boolean | null = null;

/** Whether list screens show completed tasks, remembered in this browser. */
export function useShowCompleted(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (shown ??= read()),
  );
  return [value, (next) => {
    shown = next;
    try {
      if (next) localStorage.setItem(KEY, "true");
      else localStorage.removeItem(KEY);
    } catch { /* kept until the page reloads */ }
    for (const l of listeners) l();
  }];
}

/** Forgets the in-memory copy, so the next read comes from storage (for tests). */
export function resetShowCompleted() {
  shown = null;
}
