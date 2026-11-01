import { useRef } from "react";
import type { ListDrop, ListMove } from "../lib/listMove";
import { usePressDrag } from "./usePressDrag";

interface Dragged { id: string; name: string }

interface Row { el: Element; rect: DOMRect; listId: string | null; folderId: string | null }

interface Active {
  id: string;
  container: HTMLElement;
  line: HTMLElement;
  rows: Row[];
  move: ListMove | null;
  marked: HTMLElement | null;
}

/** The sidebar's list rows (`data-list-row`) and folder names (`data-folder-row`, empty for the Lists heading) on screen, in order. */
function measure(container: HTMLElement): Row[] {
  return [...container.querySelectorAll("[data-list-row], [data-folder-row]")].flatMap((el) => {
    const rect = el.getBoundingClientRect();
    // A closed folder's lists have no height.
    if (rect.height === 0) return [];
    const folder = el.getAttribute("data-folder-row");
    return [{ el, rect, listId: el.getAttribute("data-list-row"), folderId: folder || null }];
  });
}

/** The drop at height `y`: the row there (the top half of a list is before it, the bottom half after), or the last row's below it. */
function dropAt(rows: Row[], y: number): { row: Row; drop: ListDrop } | null {
  if (rows.length === 0 || y < rows[0]!.rect.top) return null;
  const row = rows.find((r) => y < r.rect.bottom) ?? rows.at(-1)!;
  if (row.listId === null) return { row, drop: { kind: "folder", folderId: row.folderId } };
  return { row, drop: { kind: y < row.rect.top + row.rect.height / 2 ? "before" : "after", listId: row.listId } };
}

/**
 * Dragging the sidebar's lists: spread the returned `onPointerDown` and `ref` on the element that scrolls them. The
 * gesture is `usePressDrag`'s. A line shows where a list lands, or a folder's name lights up. `plan` turns a drop
 * into a move (null where it wouldn't change anything, which shows nothing), and `onMove` is called with it on release.
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
    start: ({ id }, container) => {
      const line = document.createElement("div");
      line.className = "drop-line";
      line.hidden = true;
      container.append(line);
      const rows = measure(container);
      const row = rows.find((r) => r.listId === id);
      if (row) (row.el as HTMLElement).dataset.dragging = "";
      active.current = { id, container, line, rows, move: null, marked: null };
    },
    move: (x, y) => {
      const d = active.current;
      if (!d) return;
      const box = d.container.getBoundingClientRect();
      // Outside the sidebar, a drop does nothing.
      const at = x < box.left || x > box.right ? null : dropAt(d.rows, y);
      d.move = at && latest.current.plan(d.id, at.drop);
      if (!at || !d.move || at.drop.kind === "folder") {
        d.line.hidden = true;
        mark(d, d.move ? at!.row.el as HTMLElement : null);
        return;
      }
      mark(d, null);
      d.line.hidden = false;
      d.line.style.top = `${(at.drop.kind === "before" ? at.row.rect.top : at.row.rect.bottom) - box.top + d.container.scrollTop}px`;
      d.line.style.left = `${at.row.rect.left - box.left}px`;
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
