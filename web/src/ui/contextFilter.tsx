import { createContext, useContext, useState, type ReactNode } from "react";
import { CONTEXTS } from "@claudia/shared";
import type { CommandId } from "../lib/commands";
import type { ContextFilter } from "../lib/sidebar";

const KEY = "claudia.context";
export const CONTEXT_CHOICES: { id: ContextFilter; name: string; command: CommandId }[] = [
  { id: "all", name: "All", command: "contextAll" },
  { id: "work", name: "Work", command: "contextWork" },
  { id: "personal", name: "Personal", command: "contextPersonal" },
  { id: "home", name: "Home", command: "contextHome" },
];

const isContext = (value: unknown): value is ContextFilter =>
  value === "all" || (CONTEXTS as readonly unknown[]).includes(value);

// Storage can be blocked (private windows, strict settings). Then the choice lasts until the tab closes.
const contextStore = {
  get(): ContextFilter {
    try {
      const value = localStorage.getItem(KEY);
      return isContext(value) ? value : "all";
    } catch { return "all"; }
  },
  set(value: ContextFilter) {
    try { localStorage.setItem(KEY, value); } catch { /* kept in memory only */ }
  },
};

interface ContextFilterValue { context: ContextFilter; setContext: (context: ContextFilter) => void }

const Ctx = createContext<ContextFilterValue | null>(null);

export function ContextFilterProvider({ children }: { children: ReactNode }) {
  const [context, setState] = useState<ContextFilter>(contextStore.get);
  const setContext = (next: ContextFilter) => {
    contextStore.set(next);
    setState(next);
  };
  return <Ctx.Provider value={{ context, setContext }}>{children}</Ctx.Provider>;
}

/** The context (All, Work, Personal, Home) that narrows the sidebar tree and every view. */
export function useContextFilter(): ContextFilterValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useContextFilter needs a ContextFilterProvider");
  return value;
}
