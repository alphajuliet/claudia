import { useRef } from "react";
import type { FolderDrop, FolderMove } from "../lib/folderMove";
import type { ListDrop, ListMove } from "../lib/listMove";
import { usePressDrag } from "./usePressDrag";

interface Dragged { kind: "list" | "folder"; id: string; name: string }

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
  kind: "list" | "folder";
  id: string;
  /** Where the drag began, how deep the list is and the folder it's in. */
  x: number;
  depth: number;
  home: string | null;
  container: HTMLElement;
  line: HTMLElement;
  rows: Row[];
  move: ListMove | FolderMove | null;
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

interface Spot<D = ListDrop> {
  drop: D;
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
 * The drop at (x, y) for a dragged folder, among the rows outside it. A folder's name takes it in its middle half
 * (last among its subfolders); its top quarter puts it before that folder and its bottom quarter after (or, for an
 * open folder with something showing in it, first inside). A list stands for its folder, first among the subfolders
 * that follow its lists, and the Lists heading for the top level; below the last row is the end of the top level.
 */
function folderDropAt(d: Active, y: number): Spot<FolderDrop> | null {
  const rows = d.rows.filter((r) => !r.chain.includes(d.id));
  if (rows.length === 0 || y < rows[0]!.rect.top) return null;
  const r = rows.findIndex((row) => y < row.rect.bottom);
  if (r < 0) return { drop: { kind: "into", folderId: null }, lineY: rows.at(-1)!.rect.bottom, depth: 0, lit: null };
  const row = rows[r]!;
  if (row.listId || row.folderId === null) {
    const folderId = row.listId ? row.chain[0] ?? null : null;
    return { drop: { kind: "into", folderId, atStart: true }, lineY: null, depth: 0, lit: rowOf(rows, folderId)?.el ?? null };
  }
  const folderId = row.folderId;
  const depth = row.chain.length - 2;
  const q = (y - row.rect.top) / row.rect.height;
  if (q < 0.25) return { drop: { kind: "before", folderId }, lineY: row.rect.top, depth, lit: null };
  if (q <= 0.75) return { drop: { kind: "into", folderId }, lineY: null, depth: 0, lit: row.el };
  if (rows[r + 1]?.chain.includes(folderId)) return { drop: { kind: "into", folderId, atStart: true }, lineY: null, depth: 0, lit: row.el };
  return { drop: { kind: "after", folderId }, lineY: row.rect.bottom, depth, lit: null };
}

/**
 * Dragging the sidebar's lists and folders: spread the returned `onPointerDown` and `ref` on the element that scrolls them. The
 * gesture is `usePressDrag`'s. A line shows where a list lands, indented to its level, and a folder's name lights up
 * when it goes in that folder rather than beside a list. `plan` and `planFolder` turn a drop into a move (null where it
 * wouldn't change anything, which shows nothing), and `onMove` or `onMoveFolder` is called with it on release.
 */
export function useListDrag({ plan, onMove, planFolder, onMoveFolder }: {
  plan: (id: string, drop: ListDrop) => ListMove | null;
  onMove: (id: string, move: ListMove) => void;
  planFolder: (id: string, drop: FolderDrop) => FolderMove | null;
  onMoveFolder: (id: string, move: FolderMove) => void;
}) {
  const latest = useRef({ plan, onMove, planFolder, onMoveFolder });
  latest.current = { plan, onMove, planFolder, onMoveFolder };
  const active = useRef<Active | null>(null);

  const mark = (d: Active, el: HTMLElement | null) => {
    if (d.marked !== el) delete d.marked?.dataset.dropTarget;
    if (el) el.dataset.dropTarget = "";
    d.marked = el;
  };

  return usePressDrag<Dragged>({
    pick: (target) => {
      // A field (renaming, naming a new one) or a menu button keeps its press.
      if (target.closest("input, button")) return null;
      const list = target.closest("[data-list-row]");
      const listId = list?.getAttribute("data-list-row");
      if (list && listId) return { source: list, item: { kind: "list", id: listId, name: list.querySelector(".nav-name")?.textContent ?? "" } };
      // A folder's name (the Lists heading has an empty id and stays put).
      const folder = target.closest("[data-folder-row]");
      const folderId = folder?.getAttribute("data-folder-row");
      if (folder && folderId) return { source: folder, item: { kind: "folder", id: folderId, name: folder.querySelector(".folder-name")?.textContent ?? "" } };
      return null;
    },
    label: ({ name }) => name,
    scroller: (container) => container,
    start: ({ kind, id }, container, x) => {
      const line = document.createElement("div");
      line.className = "drop-line";
      line.hidden = true;
      container.append(line);
      const rows = measure(container);
      const row = rows.find((r) => (kind === "list" ? r.listId === id : r.listId === null && r.folderId === id));
      // A folder fades with everything in it.
      const faded = kind === "folder" ? row?.el.closest("li") : row?.el;
      if (faded) (faded as HTMLElement).dataset.dragging = "";
      const chain = row?.chain ?? [null];
      active.current = { kind, id, x, depth: chain.length - 1, home: chain[0] ?? null, container, line, rows, move: null, marked: null };
    },
    move: (x, y) => {
      const d = active.current;
      if (!d) return;
      const box = d.container.getBoundingClientRect();
      // Outside the sidebar, a drop does nothing.
      const outside = x < box.left || x > box.right;
      let at: Spot<ListDrop | FolderDrop> | null;
      if (d.kind === "list") {
        const spot = outside ? null : dropAt(d, x, y);
        d.move = spot && latest.current.plan(d.id, spot.drop);
        at = spot;
      } else {
        const spot = outside ? null : folderDropAt(d, y);
        d.move = spot && latest.current.planFolder(d.id, spot.drop);
        at = spot;
      }
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
    settle: ({ kind, id }) => {
      const move = active.current?.move;
      if (!move) return null;
      return kind === "list" ? () => latest.current.onMove(id, move as ListMove) : () => latest.current.onMoveFolder(id, move as FolderMove);
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
