import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * An `error` toast is announced at once (an alert); others wait politely. `undo` shows an Undo button and also becomes
 * the last undoable change, which `useUndo` can run after the toast has gone (shake to undo, `z`).
 */
export interface ToastMessage { message: string; error?: boolean; action?: { label: string; run: () => void }; undo?: () => void }

/** The last change that can be undone: what its toast said, and how to undo it. */
export interface Undoable { message: string; run: () => void }

const SHOW_MS = 5000;

interface ToastValue {
  show: (toast: ToastMessage) => void;
  /** The last undoable change, until it's undone or another replaces it. */
  lastUndo: () => Undoable | null;
  /** Undoes the last undoable change (once), saying so in a toast. False when there's nothing to undo. */
  undo: () => boolean;
}

const Ctx = createContext<ToastValue | null>(null);

/** One toast at a time: a new one replaces the old. Each lasts five seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastMessage & { id: number }) | null>(null);
  const last = useRef<Undoable | null>(null);
  const show = useCallback((toast: ToastMessage) => {
    const undo = toast.undo;
    let entry: Undoable | null = null;
    if (undo) {
      // Runs once, from the toast or later: then there's nothing left to undo.
      entry = { message: toast.message, run: () => { if (last.current === entry) last.current = null; undo(); } };
      last.current = entry;
    }
    const action = entry ? { label: "Undo", run: entry.run } : toast.action;
    setCurrent((prev) => ({ ...toast, action, id: (prev?.id ?? 0) + 1 }));
  }, []);
  const lastUndo = useCallback(() => last.current, []);
  const undo = useCallback(() => {
    const entry = last.current;
    if (!entry) return false;
    entry.run();
    show({ message: `Undone: ${entry.message}` });
    return true;
  }, [show]);
  const value = useMemo(() => ({ show, lastUndo, undo }), [show, lastUndo, undo]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent((c) => (c?.id === current.id ? null : c)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const toast = current && (
    <div className="toast" key={current.id}>
      <span className="toast-message">{current.message}</span>
      {current.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            current.action!.run();
            setCurrent(null);
          }}
        >
          {current.action.label}
        </button>
      )}
    </div>
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {current && !current.error && toast}
      </div>
      <div className="toast-region" role="alert">
        {current?.error && toast}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useToast needs a ToastProvider");
  return value;
}
