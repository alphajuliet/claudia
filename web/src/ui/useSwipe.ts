import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { end, move, REVEAL_WIDTH, start, type SwipeState } from "../lib/swipe";

/** Presses on these are theirs, not the row's. */
const IGNORE = ".task-check, button, input, textarea, select, a";
/** The row width when the element has none (jsdom). */
const FALLBACK_WIDTH = 320;
/** How long the spring back runs (the CSS transition). */
const SPRING_MS = 180;
/** How long after a swipe its click may come. iOS sends none after a drag, so a later click is someone else's. */
const SWALLOW_MS = 500;

type Mode = "drag" | "spring" | "open" | null;

/**
 * Touch swipes on a task row: right past COMPLETE_AT of the width calls `onComplete`; left past REVEAL_AT of the
 * buttons' width (when `allowLeft`) calls `onReveal`, and the row stays `open` at -REVEAL_WIDTH until `open` turns
 * false. On an open row, a swipe right or a tap calls `onCloseActions` instead. Anything shorter springs back.
 * While swiping it sets `--swipe-x` and `data-swipe` ("drag", then "spring" on the way back or "open" while open; both animate) on
 * the row, and the click the browser sends after a swipe is swallowed so the row doesn't also open. Mouse and pen
 * presses, and presses on the row's controls, are left alone. Spread the returned handlers (and `ref`) on the row.
 */
export function useSwipe<T extends HTMLElement>({ onComplete, onReveal, onCloseActions, open = false, allowLeft = false, disabled = false }: {
  onComplete: () => void;
  onReveal?: () => void;
  onCloseActions?: () => void;
  open?: boolean;
  allowLeft?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<T>(null);
  const state = useRef<SwipeState | null>(null);
  const pointer = useRef<number | null>(null);
  // The row holds the pointer's capture (taken once a swipe starts).
  const captured = useRef(false);
  // Until when the click after a swipe is swallowed (0 for none).
  const swallow = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isOpen = useRef(open);
  isOpen.current = open;

  const set = (el: T, dx: number, mode: Mode) => {
    el.style.setProperty("--swipe-x", `${dx}px`);
    if (mode) el.dataset.swipe = mode;
    else delete el.dataset.swipe;
  };

  /** Moves to `dx` with the transition: open there, or back to no swipe at 0. */
  const settle = (el: T, dx: number) => {
    clearTimeout(timer.current);
    if (dx !== 0) return set(el, dx, "open");
    set(el, 0, "spring");
    timer.current = setTimeout(() => {
      if (!state.current) delete el.dataset.swipe;
    }, SPRING_MS);
  };

  // Opening and closing come from the list (one row open at a time).
  // From false, so a row that mounts open is moved there too.
  const wasOpen = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || wasOpen.current === open) return;
    wasOpen.current = open;
    settle(el, open ? -REVEAL_WIDTH : 0);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = (e: PointerEvent<T>, cancelled: boolean) => {
    if (e.pointerId !== pointer.current) return;
    const s = state.current;
    state.current = null;
    pointer.current = null;
    captured.current = false;
    if (!s) return;
    const el = e.currentTarget;
    if (isOpen.current) {
      // A tap or a swipe right on an open row closes it; a swipe further left leaves it open.
      swallow.current = Date.now() + SWALLOW_MS;
      el.releasePointerCapture?.(e.pointerId);
      if (!cancelled && (s.phase === "pending" || s.dx > 0)) onCloseActions?.();
      else settle(el, -REVEAL_WIDTH);
      return;
    }
    if (s.phase !== "swiping") return;
    swallow.current = Date.now() + SWALLOW_MS;
    el.releasePointerCapture?.(e.pointerId);
    const outcome = cancelled ? "cancel" : end(s, el.clientWidth || FALLBACK_WIDTH);
    if (outcome === "complete") {
      set(el, 0, null);
      onComplete();
      return;
    }
    if (outcome === "reveal" && onReveal) {
      // The `open` effect springs it the rest of the way.
      onReveal();
      return;
    }
    settle(el, 0);
  };

  return {
    ref,
    onPointerDown: (e: PointerEvent<T>) => {
      // A second finger doesn't restart the swipe, but a new first one does: the last one's pointerup was lost.
      if (state.current && !e.isPrimary) return;
      state.current = null;
      pointer.current = null;
      swallow.current = 0;
      if (disabled || e.pointerType !== "touch" || (e.target as Element).closest(IGNORE)) return;
      state.current = start(e.clientX, e.clientY);
      pointer.current = e.pointerId;
    },
    onPointerMove: (e: PointerEvent<T>) => {
      const s = state.current;
      if (!s || e.pointerId !== pointer.current) return;
      const opened = isOpen.current;
      const next = move(s, e.clientX, e.clientY, allowLeft || opened);
      state.current = next;
      if (next.phase !== "swiping") {
        if (next.phase === "scrolling") {
          state.current = null;
          pointer.current = null;
        }
        return;
      }
      if (s.phase !== "swiping") {
        clearTimeout(timer.current);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        captured.current = true;
      }
      // An open row moves from where it sits, between open and closed.
      // Never further left than the buttons, so the Complete strip doesn't show behind them.
      const dx = Math.max(-REVEAL_WIDTH, opened ? Math.min(0, next.dx - REVEAL_WIDTH) : next.dx);
      set(e.currentTarget, dx, "drag");
    },
    onPointerUp: (e: PointerEvent<T>) => finish(e, false),
    onPointerCancel: (e: PointerEvent<T>) => finish(e, true),
    // Only the row's own capture, lost while the finger is still down, cancels. Taking it fires this on the child
    // that held the touch's implicit capture (it bubbles here), and our own release comes after `finish`.
    onLostPointerCapture: (e: PointerEvent<T>) => {
      if (e.target === e.currentTarget && captured.current) finish(e, true);
    },
    onClickCapture: (e: MouseEvent<T>) => {
      const until = swallow.current;
      swallow.current = 0;
      if (Date.now() > until) return;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
