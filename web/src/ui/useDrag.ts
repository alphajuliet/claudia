import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Task } from "@claudia/shared";
import { gapDepths, headingGaps, withoutDragged, type Drop, type Item } from "../lib/reorder";
import { plainText } from "./Markdown";

/** Presses on these never start a drag: they are the controls' own. */
const IGNORE = ".task-check, .disclosure, input, textarea, select, a, .swipe-actions";
/** How far the mouse moves with the button down before a press becomes a drag. */
const THRESHOLD = 5;
/** How long a finger holds still on a row before it lifts, and how far it may stray meanwhile. */
const HOLD_MS = 500;
const HOLD_SLOP = 10;
/** How long after a touch drag its click may come (iOS may send none, so a later click is someone else's). */
const TOUCH_SWALLOW_MS = 500;
/** Within this of the scroller's top or bottom, the content scrolls, by up to MAX_SCROLL px a frame. */
const EDGE = 40;
const MAX_SCROLL = 12;
/** The indent per depth when the row has no `--indent` to read (jsdom). */
const FALLBACK_INDENT = 20;

/** Where a drag ends: a drop in the list, or another list in the sidebar. */
export type DragTarget = Drop | { kind: "list"; listId: string };

interface Measured { item: Item; el: Element; rect: DOMRect; dragged: boolean }

interface Pending { pointerId: number; x: number; y: number; task: Task; depth: number; touch: boolean }

interface Active extends Pending {
  /** The items when the drag started, and without the dragged ones. */
  items: Item[];
  rest: Item[];
  measured: Measured[];
  indent: number;
  container: HTMLElement;
  scroller: HTMLElement | null;
  ghost: HTMLElement;
  line: HTMLElement;
  /** Where it would land now, and the element marked for it (a row outlined, a sidebar list). */
  target: DragTarget | null;
  marked: Element | null;
  lastX: number;
  lastY: number;
  frame: number;
  /** The finger has moved since the lift (a mouse drag starts by moving). */
  moved: boolean;
}

/** A drag (mouse or touch) is under way. A row's swipe stands down for it. */
export const isDragging = () => document.body.dataset.drag !== undefined;

/** The px of a CSS length in rem or px, or null. */
function toPx(value: string): number | null {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  if (value.trim().endsWith("rem")) return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  return n;
}

/** The items' elements and rectangles, in order. Items no longer on screen are left out. */
function measure(container: HTMLElement, items: Item[], rest: Item[]): Measured[] {
  const kept = new Set(rest.map((i) => i.task.id));
  return items.flatMap((item) => {
    const el = container.querySelector(`[data-task-id="${CSS.escape(item.task.id)}"]`);
    return el ? [{ item, el, rect: el.getBoundingClientRect(), dragged: !kept.has(item.task.id) }] : [];
  });
}

/**
 * The drop under (x, y) and the y of its line (or null for `into`). In the top or bottom quarter of a row, or
 * above or below a heading, it is the gap there; in a row's middle half it is `into` that row; in a heading's
 * middle, the gap after it. The depth of a gap follows how far the pointer has moved sideways since the press,
 * within what `gapDepths` allows. A heading only lands in `headingGaps`: the nearest one.
 */
function dropAt(d: Active, x: number, y: number): { drop: Drop; lineY: number | null } | null {
  const { rest, measured } = d;
  const shown = measured.filter((m) => !m.dragged);
  if (shown.length === 0) return null;
  const restIndex = new Map(rest.map((item, i) => [item.task.id, i]));
  // The y of each gap: the top of the row after it, or the bottom of the last. The dragged rows are still laid out
  // (faded), so only the others' edges count.
  const gapY = (g: number) => {
    const below = shown.find((m) => restIndex.get(m.item.task.id)! >= g);
    return below ? below.rect.top : shown.at(-1)!.rect.bottom;
  };
  const heading = d.task.kind === "heading";

  let gap = rest.length;
  let into: string | null = null;
  let j = 0;
  for (const m of measured) {
    const { top, bottom, height } = m.rect;
    if (m.dragged) {
      if (y < bottom) { gap = j; break; }
      continue;
    }
    if (y < bottom) {
      if (y < top + height / 4) gap = j;
      else if (!heading && m.item.kind === "row" && y <= top + (3 * height) / 4) into = m.item.task.id;
      else gap = j + 1;
      break;
    }
    j++;
  }
  if (into) return { drop: { kind: "into", taskId: into }, lineY: null };
  if (heading) {
    const near = (g: number) => Math.abs(gapY(g) - y);
    gap = headingGaps(rest).reduce((best, g) => (near(g) < near(best) ? g : best));
    return { drop: { kind: "gap", index: gap, depth: 0 }, lineY: gapY(gap) };
  }
  const { min, max } = gapDepths(rest, gap);
  const depth = Math.min(max, Math.max(min, Math.round(d.depth + (x - d.x) / d.indent)));
  return { drop: { kind: "gap", index: gap, depth }, lineY: gapY(gap) };
}

/** The sidebar list under the pointer (`data-drop-list`), unless it is this one. */
function listAt(x: number, y: number, listId: string): Element | null {
  if (typeof document.elementFromPoint !== "function") return null;
  const el = document.elementFromPoint(x, y)?.closest("[data-drop-list]");
  return el && el.getAttribute("data-drop-list") !== listId ? el : null;
}

/**
 * Dragging rows and headings to reorder a list (`listId`, or none to turn it off). Spread the returned
 * `onPointerDown` and `ref` on the element holding the rows. A mouse press on a row or a heading's line that
 * moves THRESHOLD px starts a drag: a ghost follows the pointer, the dragged rows (or a heading's section) fade and
 * a line, indented to the depth, shows where it lands (or the row it would go under is outlined). A drop calls
 * `onDrop` with the dragged task, the target and the items as they were; Escape cancels. The click after a drag is
 * swallowed, so the title doesn't rename and the row doesn't select. Over another list in the sidebar (an element
 * with `data-drop-list`), that list is the target and gets `data-drop-target`. On a touch screen a finger held still
 * for HOLD_MS lifts the row (`data-drag-lift`) and starts the same drag; one that moves first is left to scrolling
 * and the swipes, and the swipe stands down once a drag starts (`isDragging`).
 */
export function useDrag({ listId, items, onDrop }: {
  listId: string | undefined;
  items: Item[];
  onDrop: (task: Task, target: DragTarget, items: Item[]) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ listId, items, onDrop });
  latest.current = { listId, items, onDrop };
  const pending = useRef<Pending | null>(null);
  const active = useRef<Active | null>(null);
  // Removes the window listeners of the press (and drag) under way.
  const detach = useRef<() => void>(() => {});
  // Removes the click swallower left by the last drag.
  const unswallow = useRef<() => void>(() => {});

  /** Marks `el` (or nothing) as where the drop goes: a row outlined for `into`, or a sidebar list. */
  const mark = (d: Active, el: Element | null, attr: "dropInto" | "dropTarget" = "dropInto") => {
    if (d.marked && d.marked !== el) {
      delete (d.marked as HTMLElement).dataset.dropInto;
      delete (d.marked as HTMLElement).dataset.dropTarget;
    }
    if (el) (el as HTMLElement).dataset[attr] = "";
    d.marked = el;
  };

  /** Works out the target for the pointer at (x, y) and shows it. */
  const update = (d: Active, x: number, y: number) => {
    d.lastX = x;
    d.lastY = y;
    d.ghost.style.transform = `translate(${x + 12}px, ${y + 8}px)`;
    const list = listAt(x, y, latest.current.listId ?? "");
    if (list) {
      d.target = { kind: "list", listId: list.getAttribute("data-drop-list")! };
      d.line.hidden = true;
      mark(d, list, "dropTarget");
      return;
    }
    const at = dropAt(d, x, y);
    d.target = at?.drop ?? null;
    if (at?.drop.kind === "into") {
      const taskId = at.drop.taskId;
      d.line.hidden = true;
      mark(d, d.measured.find((m) => m.item.task.id === taskId)?.el ?? null);
      return;
    }
    mark(d, null);
    if (!at || at.drop.kind !== "gap" || at.lineY === null) {
      d.line.hidden = true;
      return;
    }
    d.line.hidden = false;
    d.line.style.top = `${at.lineY - d.container.getBoundingClientRect().top}px`;
    d.line.style.left = `${at.drop.depth * d.indent}px`;
  };

  /** Scrolls the content while the pointer is near its top or bottom edge, one step a frame. */
  const autoScroll = (d: Active) => {
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
    d.measured = measure(d.container, d.items, d.rest);
    update(d, d.lastX, d.lastY);
  };

  const begin = (p: Pending, container: HTMLElement): Active => {
    const items = latest.current.items;
    const rest = withoutDragged(items, p.task);
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = plainText(p.task.title);
    document.body.append(ghost);
    const line = document.createElement("div");
    line.className = "drop-line";
    line.hidden = true;
    container.append(line);
    const sample = container.querySelector(".task-row");
    const d: Active = {
      ...p, items, rest, container, ghost, line,
      measured: measure(container, items, rest),
      indent: (sample && toPx(getComputedStyle(sample).getPropertyValue("--indent"))) || FALLBACK_INDENT,
      scroller: container.closest<HTMLElement>(".content"),
      target: null, marked: null, lastX: p.x, lastY: p.y, frame: 0, moved: !p.touch,
    };
    // A heading fades with its section; a row with its subtasks.
    const faded = p.task.kind === "heading" ? [container.querySelector(`[data-task-id="${CSS.escape(p.task.id)}"]`)?.closest("section")] : d.measured.filter((m) => m.dragged).map((m) => m.el);
    for (const el of faded) if (el) (el as HTMLElement).dataset.dragging = "";
    document.body.dataset.drag = "";
    window.getSelection()?.removeAllRanges();
    active.current = d;
    return d;
  };

  /** Ends the press or drag: every listener, mark, ghost and line goes. */
  const finish = () => {
    detach.current();
    detach.current = () => {};
    pending.current = null;
    const d = active.current;
    active.current = null;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    d.ghost.remove();
    d.line.remove();
    mark(d, null);
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
  // moves go to where it began, so the listener sits on the rows' container, for as long as it is there: browsers
  // only honour preventDefault from listeners that were non-passive when the touch began. Touches elsewhere don't
  // wait on it. A long press doesn't bring up a menu either.
  const attach = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => { if (active.current?.touch && e.cancelable) e.preventDefault(); };
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
    if (!latest.current.listId || !container) return;
    const touch = e.pointerType === "touch";
    if ((e.pointerType !== "mouse" && !touch) || e.button !== 0 || !e.isPrimary) return;
    const target = e.target as Element;
    // Not from a control, nor while a title is being renamed.
    if (target.closest(IGNORE) || container.querySelector(".task-title-input")) return;
    // A heading's whole line takes the press, not only its title (as narrow as the word on a phone).
    const source = target.closest("li.task-row, h2.section-title");
    const id = (source?.matches("h2") ? source.querySelector(".section-title-button") : source)?.getAttribute("data-task-id");
    const item = id ? latest.current.items.find((i) => i.task.id === id) : undefined;
    if (!item) return;
    pending.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, task: item.task, depth: item.kind === "row" ? item.depth : 0, touch };

    // A finger lifts the row once it has held still for HOLD_MS; the drag starts where it is then.
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
      const target = d?.moved ? d.target : null;
      const items = d?.items ?? [];
      finish();
      if (!d) return;
      swallowClick(false, p.touch ? TOUCH_SWALLOW_MS : 0);
      if (target) latest.current.onDrop(p.task, target, items);
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
