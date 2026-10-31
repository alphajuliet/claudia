import { useRef, type MouseEvent, type PointerEvent } from "react";
import { end, move, start, type SwipeState } from "../lib/swipe";

/** Presses on these are theirs, not the row's. */
const IGNORE = ".task-check, button, input, textarea, select, a";
/** The row width when the element has none (jsdom). */
const FALLBACK_WIDTH = 320;
/** How long the spring back runs (the CSS transition). */
const SPRING_MS = 180;

/**
 * Touch swipes on a task row: right past COMPLETE_AT of the width calls `onComplete`; anything shorter springs back.
 * While swiping it sets `--swipe-x` and `data-swipe` ("drag", then "spring" on the way back) on the row, and the click
 * the browser sends after a swipe is swallowed so the row doesn't also open. Mouse and pen presses, and presses on the
 * row's controls, are left alone. Spread the returned handlers on the row element.
 */
export function useSwipe<T extends HTMLElement>({ onComplete, disabled = false }: { onComplete: () => void; disabled?: boolean }) {
  const state = useRef<SwipeState | null>(null);
  const pointer = useRef<number | null>(null);
  const swallow = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const set = (el: T, dx: number, mode: "drag" | "spring" | null) => {
    el.style.setProperty("--swipe-x", `${dx}px`);
    if (mode) el.dataset.swipe = mode;
    else delete el.dataset.swipe;
  };

  const finish = (e: PointerEvent<T>, cancelled: boolean) => {
    if (e.pointerId !== pointer.current) return;
    const s = state.current;
    state.current = null;
    pointer.current = null;
    if (!s || s.phase !== "swiping") return;
    const el = e.currentTarget;
    swallow.current = true;
    el.releasePointerCapture?.(e.pointerId);
    // `reveal` (the Date and Snooze buttons) comes later; until then it springs back like `cancel`.
    const outcome = cancelled ? "cancel" : end(s, el.clientWidth || FALLBACK_WIDTH);
    if (outcome === "complete") {
      set(el, 0, null);
      onComplete();
      return;
    }
    set(el, 0, "spring");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!state.current) delete el.dataset.swipe;
    }, SPRING_MS);
  };

  return {
    onPointerDown: (e: PointerEvent<T>) => {
      // A second finger doesn't restart the swipe.
      if (state.current) return;
      swallow.current = false;
      if (disabled || e.pointerType !== "touch" || (e.target as Element).closest(IGNORE)) return;
      state.current = start(e.clientX, e.clientY);
      pointer.current = e.pointerId;
    },
    onPointerMove: (e: PointerEvent<T>) => {
      const s = state.current;
      if (!s || e.pointerId !== pointer.current) return;
      const next = move(s, e.clientX, e.clientY, false);
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
      }
      set(e.currentTarget, next.dx, "drag");
    },
    onPointerUp: (e: PointerEvent<T>) => finish(e, false),
    onPointerCancel: (e: PointerEvent<T>) => finish(e, true),
    onClickCapture: (e: MouseEvent<T>) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
