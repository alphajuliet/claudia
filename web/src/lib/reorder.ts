import type { Task } from "@claudia/shared";
import type { Row } from "./tasks";

/** The rows as shown, in order: headings and task rows with their depth. Collapsed parts are not in it. */
export type Item = { kind: "heading"; task: Task } | { kind: "row"; task: Task; depth: number };

/**
 * A request for POST /api/tasks/{id}/move (id separate). `parentId` is always sent, null for the top level.
 * `afterId` (a heading, never with `beforeId`) puts a task first in that heading's section, hidden tasks or not.
 */
export interface MoveRequest { parentId: string | null; beforeId?: string; afterId?: string; listId?: string; withSection?: true }

/** Where a drop lands. */
export type Drop =
  | { kind: "gap"; index: number; depth: number } // before items[index] (index === items.length: the end)
  | { kind: "into"; taskId: string }; // last subtask of this task

/** A heading counts as depth 0. */
const depthOf = (item: Item) => (item.kind === "row" ? item.depth : 0);

/** The items of shown sections: each heading, then its rows. */
export function displayItems(sections: { heading?: Task; rows: Row[] }[]): Item[] {
  return sections.flatMap((s) => [
    ...(s.heading ? [{ kind: "heading" as const, task: s.heading }] : []),
    ...s.rows.map((r) => ({ kind: "row" as const, task: r.task, depth: r.depth })),
  ]);
}

/** The index after the item at `i` and everything under it (its subtasks, or a heading's section). */
function endOf(items: Item[], i: number): number {
  const item = items[i]!;
  let j = i + 1;
  if (item.kind === "heading") while (j < items.length && items[j]!.kind !== "heading") j++;
  else while (j < items.length && depthOf(items[j]!) > item.depth) j++;
  return j;
}

/** The first item from `from` on at `depth` before anything shallower: the next sibling at that depth. */
function nextAt(items: Item[], from: number, depth: number): Item | undefined {
  for (let j = from; j < items.length; j++) {
    const d = depthOf(items[j]!);
    if (d < depth) return undefined;
    if (d === depth) return items[j];
  }
  return undefined;
}

/** The previous sibling at `depth` before index `i`, stopping at anything shallower. */
function previousAt(items: Item[], i: number, depth: number): Item | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const d = depthOf(items[j]!);
    if (d < depth) return undefined;
    if (d === depth) return items[j];
  }
  return undefined;
}

const request = (parentId: string | null, before?: Item): MoveRequest => (before ? { parentId, beforeId: before.task.id } : { parentId });

/** First in the section of `heading`. */
const firstUnder = (heading: Item): MoveRequest => ({ parentId: null, afterId: heading.task.id });

const sectionRequest = (before?: Item): MoveRequest => ({ ...request(null, before), withSection: true });

/** The items left once the dragged task and everything under it (its subtasks, or a heading's section) are taken out. */
export function withoutDragged(items: Item[], dragged: Task): Item[] {
  const i = items.findIndex((item) => item.task.id === dragged.id);
  return i < 0 ? [...items] : [...items.slice(0, i), ...items.slice(endOf(items, i))];
}

/**
 * The depths a drop at gap `index` may take (in `items` without the dragged ones): an inclusive range.
 * No deeper than the row above and no shallower than the row below; between a task and its first subtask, only
 * the subtask's depth. Next to a heading, only the top level.
 */
export function gapDepths(items: Item[], index: number): { min: number; max: number } {
  const above = items[index - 1];
  const below = items[index];
  const max = above?.kind === "row" ? above.depth : 0;
  const min = below?.kind === "row" ? below.depth : 0;
  return { min, max: Math.max(min, max) };
}

/** The gaps a heading may land in: before a heading, or the end, never among the rows above the first heading. */
export function headingGaps(items: Item[]): number[] {
  const gaps = items.flatMap((item, i) => (item.kind === "heading" ? [i] : []));
  return [...gaps, items.length];
}

/**
 * Where a task is now, as a move request: for Undo after a move to another list. A heading's place is past its
 * section, and a task straight after a heading is first under it. A row at depth 0 is top level, even a subtask
 * whose parent isn't shown (completed): any move of it detaches it, and a drop where it is sends nothing.
 */
export function placeOf(items: Item[], task: Task): MoveRequest {
  const i = items.findIndex((item) => item.task.id === task.id);
  if (i < 0) return request(task.parentId);
  const item = items[i]!;
  if (item.kind === "heading") return request(null, items[endOf(items, i)]);
  if (item.depth === 0 && items[i - 1]?.kind === "heading") return firstUnder(items[i - 1]!);
  // Shown at the top level (a subtask whose parent isn't on screen) counts as top level, as drops and steps take it.
  return request(item.depth > 0 ? task.parentId : null, nextAt(items, i + 1, item.depth));
}

const samePlace = (a: MoveRequest, b: MoveRequest) => a.parentId === b.parentId && a.beforeId === b.beforeId && a.afterId === b.afterId;

/** The move request for a drop, or null when it lands where the task already is. `items` excludes the dragged ones. */
export function moveFor(items: Item[], dragged: Task, drop: Drop, original: Item[]): MoveRequest | null {
  const was = placeOf(original, dragged);
  if (dragged.kind === "heading") {
    if (drop.kind !== "gap" || !headingGaps(items).includes(drop.index)) return null;
    const next = sectionRequest(items[drop.index]);
    return samePlace(next, was) ? null : next;
  }
  if (drop.kind === "into") {
    const target = items.find((item) => item.task.id === drop.taskId);
    if (target?.kind !== "row") return null;
    return was.parentId === drop.taskId && !was.beforeId && !was.afterId ? null : { parentId: drop.taskId };
  }
  const { index, depth } = drop;
  let parentId: string | null = null;
  if (depth > 0) {
    let j = index - 1;
    while (j >= 0 && depthOf(items[j]!) >= depth) j--;
    const parent = items[j];
    if (parent?.kind !== "row" || parent.depth !== depth - 1) return null;
    parentId = parent.task.id;
  }
  const above = items[index - 1];
  const next = depth === 0 && above?.kind === "heading" ? firstUnder(above) : request(parentId, nextAt(items, index, depth));
  return samePlace(next, was) ? null : next;
}

/**
 * Alt+↑ / Alt+↓: the move request for the highlighted task, or null when it can't move that way. `items` include
 * the task. A subtask stays under its parent; a top-level task crosses headings; a heading moves past a section.
 */
export function stepMove(items: Item[], task: Task, direction: -1 | 1): MoveRequest | null {
  const i = items.findIndex((item) => item.task.id === task.id);
  if (i < 0) return null;
  const item = items[i]!;
  if (item.kind === "heading") {
    const headings = items.filter((x) => x.kind === "heading");
    const h = headings.findIndex((x) => x.task.id === task.id);
    if (direction < 0) return h > 0 ? sectionRequest(headings[h - 1]) : null;
    return h < headings.length - 1 ? sectionRequest(headings[h + 2]) : null;
  }
  // Siblings are the items at its depth under the same parent; at the top level headings count too.
  const parentId = item.depth > 0 ? task.parentId : null;
  if (direction < 0) {
    const previous = previousAt(items, i, item.depth);
    return previous ? request(parentId, previous) : null;
  }
  const next = nextAt(items, endOf(items, i), item.depth);
  if (!next) return null;
  // Past a heading the task goes first in its section, even when the section is collapsed.
  if (next.kind === "heading") return firstUnder(next);
  return request(parentId, nextAt(items, endOf(items, items.indexOf(next)), item.depth));
}
