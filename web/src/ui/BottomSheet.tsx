import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * A small modal sheet at the bottom of the screen, over a backdrop, for a field or two. It takes focus when it opens;
 * Tab stays inside it. Escape, Done and a tap on the backdrop call `onClose`, which also decides where focus goes next. Its keys are its
 * own, so the list's commands (j, k, Escape for the panel) don't run while it's open. In a portal, so the row's
 * clipping and transforms don't reach it.
 */
export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => ref.current?.focus(), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      // Tab and Shift+Tab go round the sheet's controls.
      const all = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = all[0];
      const last = all.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={ref} className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="bottom-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="quiet bottom-sheet-done" onClick={onClose}>Done</button>
        </header>
        <div className="bottom-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
