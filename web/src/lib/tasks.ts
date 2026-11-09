import { addDays, todayIn, weekdayOf } from "./dates";
import type { List, Task } from "@claudia/shared";

export interface Row { task: Task; depth: number }

/** The task's due date (YYYY-MM-DD): its date, or the day of its due time in the user's time zone. */
export const dueDateOf = (task: Task, timeZone: string) =>
  task.dueDate ?? (task.dueAt ? todayIn(timeZone, new Date(task.dueAt)) : null);

/** Snoozed until a time still in the future. */
export const isSnoozed = (t: Task, now = new Date()) => t.snoozedUntil !== null && t.snoozedUntil > now.toISOString();

const PRIORITY_RANK: Record<Task["priority"], number> = { high: 0, normal: 1, low: 2 };

/** High first, Low last. Stable, so tasks of equal priority keep their order. */
export const byPriority = (a: Task, b: Task) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

/**
 * Tasks in outline order: siblings by position, each followed by its subtasks. With `prioritised` (views, not a
 * list's own manual order), siblings go by priority first. A task whose parent is not in the set (e.g. a label view)
 * is shown at the top level.
 */
export function treeRows(tasks: Task[], prioritised = false): Row[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    (children.get(key) ?? children.set(key, []).get(key)!).push(t);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    if (prioritised) list.sort(byPriority);
  }
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

/** Tasks grouped by list, groups in `listOrder` (lists not in it go last), each group in outline order by priority. */
export function groupByList(tasks: Task[], lists: List[], listOrder: string[]): Group[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const rank = new Map(listOrder.map((id, i) => [id, i]));
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) (buckets.get(t.listId) ?? buckets.set(t.listId, []).get(t.listId)!).push(t);
  return [...buckets.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
    .map(([listId, ts]) => ({ listId, list: byId.get(listId), rows: treeRows(ts, true) }));
}

/** The tasks that have at least one subtask among the rows (a row followed by a deeper one). */
export function parentsIn(rows: Row[]): Set<string> {
  const out = new Set<string>();
  rows.forEach((r, i) => { if ((rows[i + 1]?.depth ?? -1) > r.depth) out.add(r.task.id); });
  return out;
}

/** The rows without anything under a collapsed task (the collapsed task itself stays). */
export function collapseRows(rows: Row[], collapsed: Set<string>): Row[] {
  const out: Row[] = [];
  let hiddenDepth = Infinity;
  for (const row of rows) {
    if (row.depth > hiddenDepth) continue;
    hiddenDepth = collapsed.has(row.task.id) ? row.depth : Infinity;
    out.push(row);
  }
  return out;
}

/** The ids of the rows under the task at `id` (its subtasks, at every level). */
export function rowsUnder(rows: Row[], id: string): string[] {
  const i = rows.findIndex((r) => r.task.id === id);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < rows.length && rows[j]!.depth > rows[i]!.depth; j++) out.push(rows[j]!.task.id);
  return out;
}

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "month" | "later" | "none";
export const DUE_BUCKETS: { id: DueBucket; title: string }[] = [
  { id: "overdue", title: "Overdue" },
  { id: "today", title: "Today" },
  { id: "tomorrow", title: "Tomorrow" },
  { id: "week", title: "This week" },
  { id: "month", title: "This month" },
  { id: "later", title: "Later" },
  { id: "none", title: "No date" },
];

/** Which due-date group a day falls in. Weeks end on Sunday; a day after tomorrow but still this week is "week". */
export function dueBucket(due: string | null, today: string): DueBucket {
  if (due === null) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due === addDays(today, 1)) return "tomorrow";
  if (due <= addDays(today, (7 - weekdayOf(today)) % 7)) return "week";
  if (due.slice(0, 7) === today.slice(0, 7)) return "month";
  return "later";
}

export interface DueGroup { bucket: DueBucket; title: string; rows: Row[] }

/**
 * Tasks grouped by due date (Overdue, Today, Tomorrow, This week, This month, Later, No date; empty groups left out).
 * Within a group: by day, then due time, priority, the list's place in `listOrder` and position. Every task is a row
 * of its own, subtasks included, since a subtask's date needn't match its parent's.
 */
export function groupByDue(tasks: Task[], today: string, timeZone: string, listOrder: string[]): DueGroup[] {
  const rank = new Map(listOrder.map((id, i) => [id, i]));
  const due = new Map(tasks.map((t) => [t.id, dueDateOf(t, timeZone)]));
  const sorted = [...tasks].sort((a, b) => {
    const da = due.get(a.id) ?? "\uffff";
    const db = due.get(b.id) ?? "\uffff";
    if (da !== db) return da < db ? -1 : 1;
    // A due time comes before an all-day date on the same day.
    const ta = a.dueAt ?? "\uffff";
    const tb = b.dueAt ?? "\uffff";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return byPriority(a, b)
      || (rank.get(a.listId) ?? Infinity) - (rank.get(b.listId) ?? Infinity)
      || (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);
  });
  return DUE_BUCKETS.map(({ id, title }) => ({
    bucket: id,
    title,
    rows: sorted.filter((t) => dueBucket(due.get(t.id) ?? null, today) === id).map((task) => ({ task, depth: 0 })),
  })).filter((g) => g.rows.length > 0);
}
