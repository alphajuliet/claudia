import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A small modal sheet at the bottom of the screen, over a backdrop, for a field or two. It takes focus when it opens;
 * Escape, Done and a tap on the backdrop call `onClose`, which also decides where focus goes next. Its keys are its
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
