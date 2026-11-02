import type { Task } from "@claudia/shared";
import { addDays } from "./dates";
import { dueDateOf } from "./tasks";

/** From the task management rules: no more than three things in progress. It's shown, not enforced. */
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
  nextDays: Task[];
  waiting: Task[];
  /** Before duplicates are removed, so they match the views they link to. */
  counts: { wip: number; overdue: number; today: number };
}

/** Sorts tasks into the Dashboard's sections. A task shows once, in the first section it fits. */
export function dashboard({ wip, due, waiting, today, timeZone }: DashboardInput): Dashboard {
  const dated = due
    .map((task) => ({ task, date: dueDateOf(task, timeZone) }))
    .filter((d): d is { task: Task; date: string } => d.date !== null)
    // A day alone sorts before a time on that day.
    .sort((a, b) => a.date.localeCompare(b.date) || (a.task.dueAt ?? "").localeCompare(b.task.dueAt ?? ""));
  const lastDay = addDays(today, NEXT_DAYS);
  const seen = new Set<string>();
  const fresh = (tasks: Task[]) => tasks.filter((t) => !seen.has(t.id) && Boolean(seen.add(t.id)));
  return {
    wip: fresh(wip),
    dueNow: fresh(dated.filter((d) => d.date <= today).map((d) => d.task)),
    nextDays: fresh(dated.filter((d) => d.date > today && d.date <= lastDay).map((d) => d.task)),
    waiting: fresh([...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
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
