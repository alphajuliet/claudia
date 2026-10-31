import { useId } from "react";
import type { Task } from "@claudia/shared";
import { usePendingCompletions, useSetCompleted, useTimeZone, useUpdateTask } from "../data/queries";
import { formatDue, todayIn } from "../lib/dates";
import type { Row } from "../lib/tasks";
import { dueDateOf, TaskRow } from "./TaskRow";
import { useToast } from "./Toast";

/** A run of rows, under a title (a list name in a view, a heading in a list) or none. */
export interface Section { key: string; title?: string; rows: Row[] }

interface QueryState { isPending: boolean; error: Error | null; refetch: () => unknown }

/** Completes a task from its checkbox and reports the outcome in the toast. */
function useComplete() {
  const setCompleted = useSetCompleted();
  const toast = useToast();
  const timeZone = useTimeZone();
  return async (task: Task) => {
    try {
      const saved = await setCompleted.mutateAsync({ task, done: true });
      const nextDue = saved.completedAt ? null : dueDateOf(saved, timeZone);
      if (nextDue) {
        toast.show({ message: `Next due ${formatDue(nextDue, todayIn(timeZone)).text}` });
        return;
      }
      toast.show({
        message: `Completed “${task.title}”${saved.subtasks > 0 ? ` and ${saved.subtasks} ${saved.subtasks === 1 ? "subtask" : "subtasks"}` : ""}`,
        action: {
          label: "Undo",
          run: () => {
            setCompleted.mutateAsync({ task: saved, done: false }).catch((e: Error) => toast.show({ message: e.message, error: true }));
          },
        },
      });
    } catch (e) {
      toast.show({ message: (e as Error).message, error: true });
    }
  };
}

/** Saves a new title (shown at once) and reports a failure in the toast; the old title comes back. */
function useRename() {
  const update = useUpdateTask();
  const toast = useToast();
  return (task: Task, title: string) => {
    update.mutateAsync({ id: task.id, patch: { title } }).catch((e: Error) => toast.show({ message: e.message, error: true }));
  };
}

function TaskSection({ section, today, timeZone, pending, onComplete, onRename }: {
  section: Section;
  today: string;
  timeZone: string;
  pending: Set<string>;
  onComplete: (task: Task) => void;
  onRename: (task: Task, title: string) => void;
}) {
  const id = useId();
  const rows = (
    <ul className="task-list">
      {section.rows.map((r) => <TaskRow key={r.task.id} task={r.task} depth={r.depth} today={today} timeZone={timeZone} pending={pending.has(r.task.id)} onComplete={onComplete} onRename={onRename} />)}
    </ul>
  );
  if (!section.title) return rows;
  return (
    <section className="task-section" aria-labelledby={id}>
      <h2 id={id} className="section-title">{section.title}</h2>
      {section.rows.length > 0 && rows}
    </section>
  );
}

/** Task rows in sections, with loading, error and empty states. */
export function TaskList({ query, sections, empty }: { query: QueryState; sections: Section[]; empty: string }) {
  const timeZone = useTimeZone();
  const today = todayIn(timeZone);
  const onComplete = useComplete();
  const onRename = useRename();
  const pending = usePendingCompletions();

  if (query.error) {
    return (
      <div className="list-state" role="alert">
        <p>{query.error.message}</p>
        <button type="button" className="quiet" onClick={() => query.refetch()}>Try again</button>
      </div>
    );
  }
  if (query.isPending) return <p className="list-state muted">Loading…</p>;
  if (sections.every((s) => s.rows.length === 0 && !s.title)) return <p className="list-state muted">{empty}</p>;
  return (
    <div className="task-sections">
      {sections.map((s) => <TaskSection key={s.key} section={s} today={today} timeZone={timeZone} pending={pending} onComplete={onComplete} onRename={onRename} />)}
    </div>
  );
}
