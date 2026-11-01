import { useRef } from "react";
import type { Task } from "@claudia/shared";
import { gapDepths, headingGaps, withoutDragged, type Drop, type Item } from "../lib/reorder";
import { plainText } from "./Markdown";
import { usePressDrag } from "./usePressDrag";

export { isDragging } from "./usePressDrag";

/** Presses on these never start a drag: they are the controls' own. */
const IGNORE = ".task-check, .disclosure, input, textarea, select, a, .swipe-actions";
/** The indent per depth when the row has no `--indent` to read (jsdom). */
const FALLBACK_INDENT = 20;

/** Where a drag ends: a drop in the list, or another list in the sidebar. */
export type DragTarget = Drop | { kind: "list"; listId: string };

interface Measured { item: Item; el: Element; rect: DOMRect; dragged: boolean }

interface Dragged { task: Task; depth: number }

interface Active extends Dragged {
  /** Where the drag began. */
  x: number;
  y: number;
  /** The items when the drag started, and without the dragged ones. */
  items: Item[];
  rest: Item[];
  measured: Measured[];
  indent: number;
  container: HTMLElement;
  line: HTMLElement;
  /** Where it would land now, and the element marked for it (a row outlined, a sidebar list). */
  target: DragTarget | null;
  marked: Element | null;
}

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
 * `onPointerDown` and `ref` on the element holding the rows. The gesture is `usePressDrag`'s. The dragged rows (or a
 * heading's section) fade and a line, indented to the depth, shows where it lands (or the row it would go under is
 * outlined). A drop calls `onDrop` with the dragged task, the target and the items as they were. Over another list
 * in the sidebar (an element with `data-drop-list`), that list is the target and gets `data-drop-target`.
 */
export function useDrag({ listId, items, onDrop }: {
  listId: string | undefined;
  items: Item[];
  onDrop: (task: Task, target: DragTarget, items: Item[]) => void;
}) {
  const latest = useRef({ listId, items, onDrop });
  latest.current = { listId, items, onDrop };
  const active = useRef<Active | null>(null);

  /** Marks `el` (or nothing) as where the drop goes: a row outlined for `into`, or a sidebar list. */
  const mark = (d: Active, el: Element | null, attr: "dropInto" | "dropTarget" = "dropInto") => {
    if (d.marked && d.marked !== el) {
      delete (d.marked as HTMLElement).dataset.dropInto;
      delete (d.marked as HTMLElement).dataset.dropTarget;
    }
    if (el) (el as HTMLElement).dataset[attr] = "";
    d.marked = el;
  };

  return usePressDrag<Dragged>({
    pick: (target, container) => {
      if (!latest.current.listId) return null;
      // Not from a control, nor while a title is being renamed.
      if (target.closest(IGNORE) || container.querySelector(".task-title-input")) return null;
      // A heading's whole line takes the press, not only its title (as narrow as the word on a phone).
      const source = target.closest("li.task-row, h2.section-title");
      const id = (source?.matches("h2") ? source.querySelector(".section-title-button") : source)?.getAttribute("data-task-id");
      const item = id ? latest.current.items.find((i) => i.task.id === id) : undefined;
      if (!source || !item) return null;
      return { source, item: { task: item.task, depth: item.kind === "row" ? item.depth : 0 } };
    },
    label: ({ task }) => plainText(task.title),
    scroller: (container) => container.closest<HTMLElement>(".content"),
    start: ({ task, depth }, container, x, y) => {
      const items = latest.current.items;
      const rest = withoutDragged(items, task);
      const line = document.createElement("div");
      line.className = "drop-line";
      line.hidden = true;
      container.append(line);
      const sample = container.querySelector(".task-row");
      const d: Active = {
        task, depth, x, y, items, rest, container, line,
        measured: measure(container, items, rest),
        indent: (sample && toPx(getComputedStyle(sample).getPropertyValue("--indent"))) || FALLBACK_INDENT,
        target: null, marked: null,
      };
      // A heading fades with its section; a row with its subtasks.
      const faded = task.kind === "heading" ? [container.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)?.closest("section")] : d.measured.filter((m) => m.dragged).map((m) => m.el);
      for (const el of faded) if (el) (el as HTMLElement).dataset.dragging = "";
      active.current = d;
    },
    move: (x, y) => {
      const d = active.current;
      if (!d) return;
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
    },
    remeasure: () => {
      const d = active.current;
      if (d) d.measured = measure(d.container, d.items, d.rest);
    },
    settle: ({ task }) => {
      const d = active.current;
      if (!d?.target) return null;
      const { target, items } = d;
      return () => latest.current.onDrop(task, target, items);
    },
    clear: () => {
      const d = active.current;
      active.current = null;
      if (!d) return;
      d.line.remove();
      mark(d, null);
    },
  });
}
