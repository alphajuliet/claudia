import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** How far the mouse moves with the button down before a press becomes a drag. */
const THRESHOLD = 5;
/** How long a finger holds still before it lifts, and how far it may stray meanwhile. */
const HOLD_MS = 500;
const HOLD_SLOP = 10;
/** How long after a touch drag its click may come (iOS may send none, so a later click is someone else's). */
const TOUCH_SWALLOW_MS = 500;
/** Within this of the scroller's top or bottom, the content scrolls, by up to MAX_SCROLL px a frame. */
const EDGE = 40;
const MAX_SCROLL = 12;

/** What a drag does: the gesture is `usePressDrag`'s, and everything about what's dragged is here. */
export interface DragSpec<T> {
  /** What a press on `target` would drag and the element that lifts for it, or null to leave the press alone. */
  pick(target: Element, container: HTMLElement): { item: T; source: Element } | null;
  /** The ghost's text. */
  label(item: T): string;
  /** The element that scrolls near its edges. */
  scroller(container: HTMLElement): HTMLElement | null;
  /** The drag has started at (x, y). */
  start(item: T, container: HTMLElement, x: number, y: number): void;
  /** The pointer is at (x, y): work out the target and show it. */
  move(x: number, y: number): void;
  /** Something scrolled: measure again (`move` follows). */
  remeasure(): void;
  /** On release: what to do once the drag is tidied away, or null for nothing. */
  settle(item: T): (() => void) | null;
  /** The drag is over: take away what `start` and `move` showed. */
  clear(): void;
}

interface Press<T> { pointerId: number; x: number; y: number; item: T; touch: boolean }

interface Drag { ghost: HTMLElement; scroller: HTMLElement | null; lastX: number; lastY: number; frame: number; moved: boolean }

/** A drag (mouse or touch) is under way. A row's swipe stands down for it. */
export const isDragging = () => document.body.dataset.drag !== undefined;

/**
 * The gesture of dragging something in a container: spread the returned `onPointerDown` and `ref` on it. A mouse press
 * that moves THRESHOLD px starts a drag. On a touch screen a finger held still for HOLD_MS lifts the element
 * (`data-drag-lift`) and starts one; a finger that moves first is left to scrolling and the swipes. A ghost follows
 * the pointer and the content scrolls near its edges. Escape cancels, and so does a second finger or a cancelled
 * touch. The click after a drag is swallowed, so it neither follows a link nor renames a title.
 */
export function usePressDrag<T>(spec: DragSpec<T>) {
  const latest = useRef(spec);
  latest.current = spec;
  const ref = useRef<HTMLElement | null>(null);
  const pending = useRef<Press<T> | null>(null);
  const active = useRef<Drag | null>(null);
  // Removes the window listeners of the press (and drag) under way.
  const detach = useRef<() => void>(() => {});
  // Removes the click swallower left by the last drag.
  const unswallow = useRef<() => void>(() => {});

  const update = (d: Drag, x: number, y: number) => {
    d.lastX = x;
    d.lastY = y;
    d.ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
    latest.current.move(x, y);
  };

  /** Scrolls the content while the pointer is near its top or bottom edge, one step a frame. */
  const autoScroll = (d: Drag) => {
    d.frame = 0;
    const s = d.scroller;
    if (!s || active.current !== d) return;
    const r = s.getBoundingClientRect();
    if (r.height <= 0) return;
    const step = d.lastY < r.top + EDGE ? -Math.ceil((MAX_SCROLL * (r.top + EDGE - d.lastY)) / EDGE)
      : d.lastY > r.bottom - EDGE ? Math.ceil((MAX_SCROLL * (d.lastY - (r.bottom - EDGE))) / EDGE) : 0;
    if (step === 0) return;
    s.scrollTop += Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, step));
    d.frame = requestAnimationFrame(() => autoScroll(d));
  };

  /** Measures again (after a scroll) and shows the target for where the pointer is. */
  const remeasure = () => {
    const d = active.current;
    if (!d) return;
    latest.current.remeasure();
    update(d, d.lastX, d.lastY);
  };

  const begin = (p: Press<T>, container: HTMLElement): Drag => {
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = latest.current.label(p.item);
    document.body.append(ghost);
    latest.current.start(p.item, container, p.x, p.y);
    document.body.dataset.drag = "";
    window.getSelection()?.removeAllRanges();
    const d: Drag = { ghost, scroller: latest.current.scroller(container), lastX: p.x, lastY: p.y, frame: 0, moved: !p.touch };
    active.current = d;
    return d;
  };

  /** Ends the press or drag: every listener and mark goes. */
  const finish = () => {
    detach.current();
    detach.current = () => {};
    pending.current = null;
    const d = active.current;
    active.current = null;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    d.ghost.remove();
    latest.current.clear();
    for (const el of document.querySelectorAll("[data-dragging], [data-drag-lift]")) {
      delete (el as HTMLElement).dataset.dragging;
      delete (el as HTMLElement).dataset.dragLift;
    }
    delete document.body.dataset.drag;
  };

  /**
   * Swallows the click the browser sends after the drag, and only that one. After an Escape the button is still
   * down: the click comes after the next pointerup, so the swallower waits for it. After a touch it waits `ms`, as
   * the click may come late or not at all.
   */
  const swallowClick = (untilUp = false, ms = 0) => {
    unswallow.current();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      unswallow.current();
    };
    const onUp = () => {
      clearTimeout(timer);
      timer = setTimeout(() => unswallow.current(), ms);
    };
    const onDown = () => unswallow.current();
    window.addEventListener("click", onClick, true);
    // A new press anywhere (Undo on the toast, say) has a click of its own.
    window.addEventListener("pointerdown", onDown, true);
    if (untilUp) window.addEventListener("pointerup", onUp, true);
    else onUp();
    unswallow.current = () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      clearTimeout(timer);
      unswallow.current = () => {};
    };
  };

  useEffect(() => () => {
    finish();
    unswallow.current();
  }, []);

  // While a finger drags, the page doesn't scroll under it (nor, in Chromium, cancel the pointer to pan). A touch's
  // moves go to where it began, so the listener sits on the container, for as long as it is there: browsers
  // only honour preventDefault from listeners that were non-passive when the touch began. Touches elsewhere don't
  // wait on it. A long press doesn't bring up a menu either.
  const attach = useCallback((el: HTMLElement | null) => {
    ref.current = el;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => { if (active.current && pending.current?.touch && e.cancelable) e.preventDefault(); };
    const onMenu = (e: Event) => { if (pending.current?.touch) e.preventDefault(); };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("contextmenu", onMenu);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("contextmenu", onMenu);
      if (ref.current === el) ref.current = null;
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    unswallow.current();
    const container = ref.current;
    // A press still under way lost its pointerup (the mouse let go outside the window): start afresh.
    finish();
    if (!container) return;
    const touch = e.pointerType === "touch";
    if ((e.pointerType !== "mouse" && !touch) || e.button !== 0 || !e.isPrimary) return;
    const picked = latest.current.pick(e.target as Element, container);
    if (!picked) return;
    const { item, source } = picked;
    pending.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, item, touch };

    // A finger lifts the element once it has held still for HOLD_MS; the drag starts where it is then.
    let at = { x: e.clientX, y: e.clientY };
    const hold = touch ? setTimeout(() => {
      const p = pending.current;
      if (!p || active.current) return;
      const d = begin({ ...p, ...at }, container);
      (source as HTMLElement).dataset.dragLift = "";
      d.ghost.style.transform = `translate(${at.x + 12}px, ${at.y + 8}px)`;
    }, HOLD_MS) : undefined;

    const onMove = (ev: PointerEvent) => {
      const p = pending.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      let d = active.current;
      if (!d) {
        const far = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
        // A finger that moves before the lift scrolls or swipes, as it always did.
        if (p.touch) {
          if (far > HOLD_SLOP) finish();
          else at = { x: ev.clientX, y: ev.clientY };
          return;
        }
        if (far < THRESHOLD) return;
        d = begin(p, container);
      }
      ev.preventDefault();
      d.moved = true;
      update(d, ev.clientX, ev.clientY);
      if (!d.frame) autoScroll(d);
    };
    const onUp = (ev: PointerEvent) => {
      const p = pending.current;
      if (!p || ev.pointerId !== p.pointerId) return;
      const d = active.current;
      // Let go without moving after the lift, it stays where it was.
      if (d?.moved) update(d, ev.clientX, ev.clientY);
      const then = d?.moved ? latest.current.settle(p.item) : null;
      finish();
      if (!d) return;
      swallowClick(false, p.touch ? TOUCH_SWALLOW_MS : 0);
      then?.();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pending.current?.pointerId) finish();
    };
    const onTouchCancel = () => { if (pending.current?.touch) finish(); };
    // A second finger (a pinch, say) cancels a touch press or drag.
    const onOtherDown = (ev: PointerEvent) => { if (ev.pointerId !== pending.current?.pointerId) finish(); };
    // Escape cancels the drag and goes no further, so the panel stays open.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !active.current) return;
      ev.stopPropagation();
      ev.preventDefault();
      finish();
      swallowClick(true);
    };
    const onScroll = () => remeasure();
    const noSelect = (ev: Event) => { if (active.current) ev.preventDefault(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (touch) {
      window.addEventListener("touchcancel", onTouchCancel);
      window.addEventListener("pointerdown", onOtherDown, true);
    }
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("selectstart", noSelect);
    detach.current = () => {
      clearTimeout(hold);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("pointerdown", onOtherDown, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("selectstart", noSelect);
    };
  };

  return { ref: attach, onPointerDown };
}
