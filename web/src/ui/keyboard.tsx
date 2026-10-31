import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { COMMANDS, type CommandId } from "../lib/commands";
import { createMatcher, ignoresKeys } from "../lib/keymap";

/** Runs a command; returning false means "not mine here", and the key keeps its usual effect. */
export type CommandHandler = () => boolean | void;

type Registry = Map<CommandId, CommandHandler[]>;

const KeyboardContext = createContext<Registry | null>(null);

/**
 * One window `keydown` listener for every command. The handler registered last for a command runs it. Keys typed
 * in fields, with Ctrl, ⌘ or Alt, or already handled further in (`preventDefault`, or stopped) are left alone.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const registry = useRef<Registry>(new Map()).current;

  useEffect(() => {
    const matcher = createMatcher(COMMANDS);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || ignoresKeys(e)) return;
      const id = matcher.match(e.key, Date.now());
      if (id === "pending") {
        e.preventDefault();
        return;
      }
      if (!id) return;
      const handlers = registry.get(id) ?? [];
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i]!() !== false) {
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [registry]);

  return <KeyboardContext.Provider value={registry}>{children}</KeyboardContext.Provider>;
}

/**
 * Handles a command while the component is mounted (and `handler` is set). The latest `handler` is always the
 * one called, so it may close over fresh state. Handlers registered later are tried first.
 */
export function useCommand(id: CommandId, handler: CommandHandler | undefined) {
  const registry = useContext(KeyboardContext);
  const latest = useRef(handler);
  latest.current = handler;
  const enabled = handler !== undefined;
  useEffect(() => {
    if (!registry || !enabled) return;
    const run: CommandHandler = () => (latest.current ? latest.current() : false);
    const list = registry.get(id) ?? [];
    registry.set(id, [...list, run]);
    return () => {
      registry.set(id, (registry.get(id) ?? []).filter((h) => h !== run));
    };
  }, [registry, id, enabled]);
}
