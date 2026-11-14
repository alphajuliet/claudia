import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Why it can't be chosen now, shown under it; the item is disabled. */
  disabledNote?: string;
  danger?: boolean;
}

/**
 * A ⋯ button that opens a small menu of commands, for a sidebar row. On a mouse screen the button shows while the row is
 * hovered or has focus (styles.css); on a touch screen it always shows. The menu sits over the page (so the sidebar
 * doesn't clip it), takes focus, and moves with ↑ and ↓; Escape, Tab, a click elsewhere or choosing an item closes it.
 * Keys pressed in it go no further, so the app's shortcuts don't run.
 */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Below the button, right-aligned, or above it when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const height = menu.current.offsetHeight;
    const below = b.bottom + 4 + height <= window.innerHeight;
    setStyle({ position: "fixed", right: Math.max(4, window.innerWidth - b.right), top: below ? b.bottom + 4 : Math.max(4, b.top - 4 - height) });
    menu.current.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  // A press outside, or the page scrolling or resizing, closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const onMove = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      close(false);
      return;
    }
    e.stopPropagation();
    const all = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
  };

  // Inside a folder's <summary>, a click would also open or close the folder.
  const onButton = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!open);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="row-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-open={open ? "" : undefined}
        onClick={onButton}
        onKeyDown={(e) => {
          // Enter and Space on the button belong to it, not the summary or the app's keys.
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={menu} id={id} className="row-menu" role="menu" aria-label={label} style={style} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? "danger" : undefined}
              aria-disabled={item.disabledNote ? "true" : undefined}
              onClick={() => {
                if (item.disabledNote) return;
                close(false);
                item.onSelect();
              }}
            >
              {item.label}
              {item.disabledNote && <span className="row-menu-note">{item.disabledNote}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
