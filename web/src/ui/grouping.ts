import { useSyncExternalStore } from "react";

export type Grouping = "list" | "due";

const KEY = "claudia.grouping";
const listeners = new Set<() => void>();

const read = (): Record<string, Grouping> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Grouping>) : {};
  } catch {
    return {};
  }
};
let chosen: Record<string, Grouping> | null = null;

/** How a view groups its tasks, by list (the default) or by due date, remembered per view in this browser. */
export function useGrouping(view: string): [Grouping, (value: Grouping) => void] {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (chosen ??= read()),
  );
  return [all[view] === "due" ? "due" : "list", (next) => {
    const { [view]: _old, ...rest } = chosen ?? read();
    chosen = next === "list" ? rest : { ...rest, [view]: next };
    try {
      if (Object.keys(chosen).length) localStorage.setItem(KEY, JSON.stringify(chosen));
      else localStorage.removeItem(KEY);
    } catch { /* kept until the page reloads */ }
    for (const l of listeners) l();
  }];
}

/** Forgets the in-memory copy, so the next read comes from storage (for tests). */
export function resetGrouping() {
  chosen = null;
}
