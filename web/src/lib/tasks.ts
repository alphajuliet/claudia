import type { List, Task } from "@claudia/shared";

export interface Row { task: Task; depth: number }

/** Snoozed until a time still in the future. */
export const isSnoozed = (t: Task, now = new Date()) => t.snoozedUntil !== null && t.snoozedUntil > now.toISOString();

/**
 * Tasks in outline order: siblings by position, each followed by its subtasks.
 * A task whose parent is not in the set (e.g. a label view) is shown at the top level.
 */
export function treeRows(tasks: Task[]): Row[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    (children.get(key) ?? children.set(key, []).get(key)!).push(t);
  }
  for (const list of children.values()) list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const rows: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of children.get(parent) ?? []) {
      rows.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export interface Group { listId: string; list: List | undefined; rows: Row[] }

/** Tasks grouped by list, groups in `listOrder` (lists not in it go last), each group in outline order. */
export function groupByList(tasks: Task[], lists: List[], listOrder: string[]): Group[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const rank = new Map(listOrder.map((id, i) => [id, i]));
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) (buckets.get(t.listId) ?? buckets.set(t.listId, []).get(t.listId)!).push(t);
  return [...buckets.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
    .map(([listId, ts]) => ({ listId, list: byId.get(listId), rows: treeRows(ts) }));
}
