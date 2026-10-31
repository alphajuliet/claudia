import type { CSSProperties } from "react";
import type { Task } from "@claudia/shared";
import { formatDue, todayIn } from "../lib/dates";

/** The task's due date (YYYY-MM-DD): its date, or the day of its due time in the user's time zone. */
export const dueDateOf = (task: Task, timeZone: string) =>
  task.dueDate ?? (task.dueAt ? todayIn(timeZone, new Date(task.dueAt)) : null);

/** One task. While `pending` (a complete or reopen is running), its checkbox is disabled so a double click sends one. */
export function TaskRow({ task, depth, today, timeZone, pending, onComplete }: {
  task: Task;
  depth: number;
  today: string;
  timeZone: string;
  pending: boolean;
  onComplete: (task: Task) => void;
}) {
  const due = dueDateOf(task, timeZone);
  const label = due ? formatDue(due, today) : null;
  return (
    <li className={pending ? "task-row pending" : "task-row"} data-depth={depth} style={{ "--depth": depth } as CSSProperties}>
      <input type="checkbox" className="task-check" aria-label={`Complete ${task.title}`} checked={false} disabled={pending} onChange={() => onComplete(task)} />
      <span className="task-title">{task.title}</span>
      <span className="task-meta">
        {task.labels.map((l) => <span key={l} className="chip">{l}</span>)}
        {label && <span className={label.overdue ? "due overdue" : "due"}>{label.text}</span>}
        {task.recurRule && (
          <span className="repeat" title="Repeats">
            <span aria-hidden="true">↻</span>
            <span className="sr-only">Repeats</span>
          </span>
        )}
      </span>
    </li>
  );
}
