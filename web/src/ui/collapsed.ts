import { useSyncExternalStore } from "react";

const KEY = "claudia.collapsed";

function load(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  } catch { return new Set(); }
}

let collapsed: Set<string> | null = null;
const listeners = new Set<() => void>();

const current = () => (collapsed ??= load());

/** Collapses or expands a heading or parent task, remembered in this browser. */
export function setCollapsed(id: string, value: boolean) {
  const next = new Set(current());
  if (value) next.add(id);
  else next.delete(id);
  collapsed = next;
  try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* kept until the page reloads */ }
  for (const l of listeners) l();
}

/** Forgets the in-memory copy, so the next read comes from storage (for tests). */
export function resetCollapsed() {
  collapsed = null;
}

/** The ids of collapsed headings and parent tasks. Ids of tasks that have gone do no harm. */
export function useCollapsed(): Set<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
  );
}
