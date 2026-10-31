import { useId } from "react";
import type { Task } from "@claudia/shared";
import { usePendingCompletions, useSetCompleted, useTimeZone, useUpdateTask } from "../data/queries";
import { formatDue, todayIn } from "../lib/dates";
import type { Row } from "../lib/tasks";
import { dueDateOf, TaskRow } from "./TaskRow";
import { useSelectedTask } from "./selection";
import { useToast } from "./Toast";

/**
 * A run of rows, under a title (a list name in a view, a heading in a list) or none. A heading's title selects it,
 * as a row would.
 */
export interface Section { key: string; title?: string; heading?: Task; rows: Row[] }

interface QueryState { isPending: boolean; error: Error | null; refetch: () => unknown }

/** Completes a task from its checkbox and reports the outcome in the toast. */
export function useComplete() {
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

interface RowProps {
  today: string;
  timeZone: string;
  pending: Set<string>;
  selectedId: string | null;
  onComplete: (task: Task) => void;
  onRename: (task: Task, title: string) => void;
  onSelect: (task: Task) => void;
}

function TaskSection({ section, pending, selectedId, ...rest }: RowProps & { section: Section }) {
  const { heading } = section;
  const id = useId();
  const rows = (
    <ul className="task-list">
      {section.rows.map((r) => (
        <TaskRow key={r.task.id} task={r.task} depth={r.depth} pending={pending.has(r.task.id)} selected={r.task.id === selectedId} {...rest} />
      ))}
    </ul>
  );
  if (!section.title) return rows;
  return (
    <section className="task-section" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {heading ? (
          <button
            type="button"
            className={heading.id === selectedId ? "section-title-button selected" : "section-title-button"}
            aria-current={heading.id === selectedId ? "true" : undefined}
            onClick={() => rest.onSelect(heading)}
          >
            {section.title}
          </button>
        ) : section.title}
      </h2>
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
  const { selectedId, select } = useSelectedTask();

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
      {sections.map((s) => (
        <TaskSection
          key={s.key}
          section={s}
          today={today}
          timeZone={timeZone}
          pending={pending}
          selectedId={selectedId}
          onComplete={onComplete}
          onRename={onRename}
          onSelect={(t) => select(t.id)}
        />
      ))}
    </div>
  );
}
