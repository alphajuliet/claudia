import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface ToastMessage { message: string; action?: { label: string; run: () => void } }

const SHOW_MS = 5000;

interface ToastValue { show: (toast: ToastMessage) => void }

const Ctx = createContext<ToastValue | null>(null);

/** One toast at a time: a new one replaces the old. Each lasts five seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastMessage & { id: number }) | null>(null);
  const show = useCallback((toast: ToastMessage) => setCurrent((prev) => ({ ...toast, id: (prev?.id ?? 0) + 1 })), []);
  const value = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent((c) => (c?.id === current.id ? null : c)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {current && (
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
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useToast needs a ToastProvider");
  return value;
}
