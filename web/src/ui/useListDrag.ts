import { useRef } from "react";
import type { ListDrop, ListMove } from "../lib/listMove";
import { usePressDrag } from "./usePressDrag";

interface Dragged { id: string; name: string }

interface Row {
  el: Element;
  rect: DOMRect;
  listId: string | null;
  /** The folder of a folder's name; null for a list and the Lists heading. */
  folderId: string | null;
  /** The folders it sits in, innermost first (a folder's name counts as in itself), ending with null for the top. */
  chain: (string | null)[];
}

interface Active {
  id: string;
  /** Where the drag began, how deep the list is and the folder it's in. */
  x: number;
  depth: number;
  home: string | null;
  container: HTMLElement;
  line: HTMLElement;
  rows: Row[];
  move: ListMove | null;
  marked: HTMLElement | null;
}

/** One level of the sidebar's nesting, as `.folder > .nav-list` indents it. */
const indent = () => 1.35 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

/** The folders around `el`, innermost first, ending with null. */
function chainOf(el: Element): (string | null)[] {
  const out: (string | null)[] = [];
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null)
    out.push(d.querySelector(":scope > summary")?.getAttribute("data-folder-row") || null);
  return [...out, null];
}

/** The sidebar's list rows (`data-list-row`) and folder names (`data-folder-row`, empty for the Lists heading) on screen, in order. */
function measure(container: HTMLElement): Row[] {
  return [...container.querySelectorAll("[data-list-row], [data-folder-row]")].flatMap((el) => {
    const rect = el.getBoundingClientRect();
    // A closed folder's lists have no height.
    if (rect.height === 0) return [];
    return [{ el, rect, listId: el.getAttribute("data-list-row"), folderId: el.getAttribute("data-folder-row") || null, chain: chainOf(el) }];
  });
}

interface Spot {
  drop: ListDrop;
  /** The height of the line, or null for none, and how deep it sits. */
  lineY: number | null;
  depth: number;
  /** The folder's row to light up, when it lands in a folder rather than beside a list. */
  lit: Element | null;
}

const rowOf = (rows: Row[], folderId: string | null) => rows.find((r) => r.listId === null && r.folderId === folderId) ?? null;

/**
 * The drop in the gap above `rows[g]` (or after the last row). Before a list it lands beside that list. Elsewhere one
 * or more folders end here, so the pointer's sideways movement since the press picks one: it starts from the list's
 * own folder if that's one of them, or else the innermost, and each indent left or right is a level out or in.
 */
function gapDrop(d: Active, rows: Row[], g: number, x: number): Spot | null {
  const above = rows[g - 1];
  const below = rows[g];
  if (!above) return null;
  const lineY = below?.rect.top ?? above.rect.bottom;
  if (below?.listId) return { drop: { kind: "before", listId: below.listId }, lineY, depth: below.chain.length - 1, lit: null };
  const outer = below ? below.chain.slice(1) : [null];
  const last = above.chain.findIndex((f) => outer.includes(f));
  const ending = above.chain.slice(0, last + 1);
  const own = d.home === null ? -1 : ending.indexOf(d.home);
  const i = Math.min(ending.length - 1, Math.max(0, (own < 0 ? 0 : own) - Math.round((x - d.x) / indent())));
  const folderId = ending[i]!;
  const depth = above.chain.length - 1 - i;
  if (above.listId && i === 0) return { drop: { kind: "after", listId: above.listId }, lineY, depth, lit: null };
  return { drop: { kind: "folder", folderId }, lineY, depth, lit: rowOf(rows, folderId)?.el ?? null };
}

/**
 * The drop at (x, y). The top half of a list is the gap above it and the bottom half the gap below. A folder's name
 * takes the drop in its middle half, with a gap at either edge; the Lists heading takes all of it. Below the
 * last row is the gap after it.
 */
function dropAt(d: Active, x: number, y: number): Spot | null {
  const rows = d.rows.filter((r) => r.listId !== d.id);
  if (rows.length === 0 || y < rows[0]!.rect.top) return null;
  const r = rows.findIndex((row) => y < row.rect.bottom);
  if (r < 0) return gapDrop(d, rows, rows.length, x);
  const { rect, listId, folderId } = rows[r]!;
  if (listId) return gapDrop(d, rows, y < rect.top + rect.height / 2 ? r : r + 1, x);
  if (r === 0 || (y >= rect.top + rect.height / 4 && y <= rect.top + (3 * rect.height) / 4))
    return { drop: { kind: "folder", folderId }, lineY: null, depth: 0, lit: rows[r]!.el };
  return gapDrop(d, rows, y < rect.top + rect.height / 2 ? r : r + 1, x);
}

/**
 * Dragging the sidebar's lists: spread the returned `onPointerDown` and `ref` on the element that scrolls them. The
 * gesture is `usePressDrag`'s. A line shows where a list lands, indented to its level, and a folder's name lights up
 * when it goes in that folder rather than beside a list. `plan` turns a drop into a move (null where it wouldn't change
 * anything, which shows nothing), and `onMove` is called with it on release.
 */
export function useListDrag({ plan, onMove }: {
  plan: (id: string, drop: ListDrop) => ListMove | null;
  onMove: (id: string, move: ListMove) => void;
}) {
  const latest = useRef({ plan, onMove });
  latest.current = { plan, onMove };
  const active = useRef<Active | null>(null);

  const mark = (d: Active, el: HTMLElement | null) => {
    if (d.marked !== el) delete d.marked?.dataset.dropTarget;
    if (el) el.dataset.dropTarget = "";
    d.marked = el;
  };

  return usePressDrag<Dragged>({
    pick: (target) => {
      if (target.closest("input")) return null;
      const source = target.closest("[data-list-row]");
      const id = source?.getAttribute("data-list-row");
      if (!source || !id) return null;
      return { source, item: { id, name: source.querySelector(".nav-name")?.textContent ?? "" } };
    },
    label: ({ name }) => name,
    scroller: (container) => container,
    start: ({ id }, container, x) => {
      const line = document.createElement("div");
      line.className = "drop-line";
      line.hidden = true;
      container.append(line);
      const rows = measure(container);
      const row = rows.find((r) => r.listId === id);
      if (row) (row.el as HTMLElement).dataset.dragging = "";
      const chain = row?.chain ?? [null];
      active.current = { id, x, depth: chain.length - 1, home: chain[0] ?? null, container, line, rows, move: null, marked: null };
    },
    move: (x, y) => {
      const d = active.current;
      if (!d) return;
      const box = d.container.getBoundingClientRect();
      // Outside the sidebar, a drop does nothing.
      const at = x < box.left || x > box.right ? null : dropAt(d, x, y);
      d.move = at && latest.current.plan(d.id, at.drop);
      const shown = d.move ? at : null;
      mark(d, (shown?.lit ?? null) as HTMLElement | null);
      if (shown?.lineY == null) {
        d.line.hidden = true;
        return;
      }
      d.line.hidden = false;
      d.line.style.top = `${shown.lineY - box.top + d.container.scrollTop}px`;
      d.line.style.left = `${shown.depth * indent()}px`;
    },
    remeasure: () => {
      const d = active.current;
      if (d) d.rows = measure(d.container);
    },
    settle: ({ id }) => {
      const move = active.current?.move;
      return move ? () => latest.current.onMove(id, move) : null;
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
