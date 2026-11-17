import { CONTEXTS, type Counts, type Folder, type Label, type List, type Task } from "@claudia/shared";
import { addDays } from "./dates";
import { byPriority, dueDateOf } from "./tasks";

/** From the task management rules: no more than three things in progress in each context. It's shown, not enforced. */
export const WIP_LIMIT = 3;
/** Rows shown in a Dashboard section before "more". */
export const SECTION_LIMIT = 5;
/** Days after today in the Next 3 days section. */
export const NEXT_DAYS = 3;

const DAY_MS = 86_400_000;

export interface DashboardInput { wip: Task[]; due: Task[]; waiting: Task[]; today: string; timeZone: string }

export interface Dashboard {
  wip: Task[];
  dueNow: Task[];
  waiting: Task[];
  nextDays: Task[];
  /** Before duplicates are removed, so they match the views they link to. */
  counts: { wip: number; overdue: number; today: number };
}

/** Sorts tasks into the Dashboard's sections, each by priority. A task shows once, in the first section it fits. */
export function dashboard({ wip, due, waiting, today, timeZone }: DashboardInput): Dashboard {
  const dated = due
    .map((task) => ({ task, date: dueDateOf(task, timeZone) }))
    .filter((d): d is { task: Task; date: string } => d.date !== null)
    // A day alone sorts before a time on that day.
    .sort((a, b) => a.date.localeCompare(b.date) || (a.task.dueAt ?? "").localeCompare(b.task.dueAt ?? ""));
  const lastDay = addDays(today, NEXT_DAYS);
  const seen = new Set<string>();
  const fresh = (tasks: Task[]) => tasks.filter((t) => !seen.has(t.id) && Boolean(seen.add(t.id))).sort(byPriority);
  return {
    wip: fresh(wip),
    dueNow: fresh(dated.filter((d) => d.date <= today).map((d) => d.task)),
    // In the order shown: Waiting comes before Next 3 days.
    waiting: fresh([...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    nextDays: fresh(dated.filter((d) => d.date > today && d.date <= lastDay).map((d) => d.task)),
    counts: {
      wip: wip.length,
      overdue: dated.filter((d) => d.date < today).length,
      today: dated.filter((d) => d.date === today).length,
    },
  };
}

/** Whole days since the task was created, as "12d", or null within the first day. */
export function ageOf(task: Task, now = new Date()): string | null {
  const days = Math.floor((now.getTime() - Date.parse(task.createdAt)) / DAY_MS);
  return days >= 1 ? `${days}d` : null;
}

/**
 * The lists in a context, as the server narrows views: lists outside any folder, the Inbox, and lists whose folders
 * (and every folder above) are in the context. Null for All.
 */
export function listsInContext(lists: List[], folders: Folder[], context: Folder["context"] | "all"): Set<string> | null {
  if (context === "all") return null;
  const shown = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const f of folders) if (f.parentId === parentId && f.context === context && !shown.has(f.id)) { shown.add(f.id); walk(f.id); }
  };
  walk(null);
  return new Set(lists.filter((l) => l.inbox || l.folderId === null || shown.has(l.folderId)).map((l) => l.id));
}

/**
 * WIP in each context, against the limit. A task in a list outside any folder (the Inbox, say) shows in every
 * context, so it counts in each, as choosing that context would show it.
 */
export function wipByContext(wip: Task[], lists: List[], folders: Folder[]) {
  return CONTEXTS.map((context) => {
    const ids = listsInContext(lists, folders, context)!;
    return { context, count: wip.filter((t) => ids.has(t.listId)).length };
  });
}

export interface StatusCount { label: string | null; count: number }

/**
 * Open tasks by status label, in the Labels screen's order, then those with none (label null). From the sidebar's
 * counts, so it leaves out headings and snoozed tasks, as the counts do. `listIds` narrows to a context.
 */
export function statusCounts(counts: Counts, labels: Label[], listIds: Set<string> | null): StatusCount[] {
  const status = labels.filter((l) => l.status).sort((a, b) => (a.statusPosition ?? "").localeCompare(b.statusPosition ?? ""));
  const totals = new Map(status.map((l) => [l.name.toLowerCase(), 0]));
  let open = 0;
  for (const [listId, list] of Object.entries(counts.lists)) {
    if (listIds && !listIds.has(listId)) continue;
    open += list.open;
    for (const [name, n] of Object.entries(list.labels)) if (totals.has(name)) totals.set(name, totals.get(name)! + n);
  }
  const rows = status.map((l) => ({ label: l.name, count: totals.get(l.name.toLowerCase())! }));
  return [...rows, { label: null, count: Math.max(0, open - rows.reduce((sum, r) => sum + r.count, 0)) }];
}
