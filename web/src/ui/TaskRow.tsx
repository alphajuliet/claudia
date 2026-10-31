import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { Task } from "@claudia/shared";
import { formatDue, todayIn } from "../lib/dates";

/** The task's due date (YYYY-MM-DD): its date, or the day of its due time in the user's time zone. */
export const dueDateOf = (task: Task, timeZone: string) =>
  task.dueDate ?? (task.dueAt ? todayIn(timeZone, new Date(task.dueAt)) : null);

/**
 * The title, as a button that turns into a text input in place. Enter or leaving the field saves a changed,
 * non-empty title through `onRename`; Escape cancels. After a keyboard save or cancel, focus returns to the title.
 */
function TaskTitle({ task, onRename }: { task: Task; onRename: (task: Task, title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const refocus = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (draft === null && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [draft]);

  const finish = (save: boolean) => {
    // Enter or Escape unmounts the input, which may also fire blur: act once.
    if (done.current || draft === null) return;
    done.current = true;
    const title = draft.trim();
    if (save && title && title !== task.title) onRename(task, title);
    setDraft(null);
  };

  if (draft === null) {
    return (
      <button
        ref={button}
        type="button"
        className="task-title"
        onClick={() => {
          done.current = false;
          setDraft(task.title);
        }}
      >
        {task.title}
      </button>
    );
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      refocus.current = true;
      finish(true);
    } else if (e.key === "Escape") {
      // Keep Escape for the field, not anything listening further up (such as the drawer).
      e.stopPropagation();
      refocus.current = true;
      finish(false);
    }
  };
  return (
    <input
      type="text"
      className="task-title task-title-input"
      aria-label="Title"
      autoFocus
      autoComplete="off"
      enterKeyHint="done"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  );
}

/**
 * One task. While `pending` (a complete or reopen is running), its checkbox is disabled so a double click sends one.
 * `onSelect` is called for clicks on the row outside the checkbox and title (the detail panel's hook).
 */
export function TaskRow({ task, depth, today, timeZone, pending, onComplete, onRename, onSelect }: {
  task: Task;
  depth: number;
  today: string;
  timeZone: string;
  pending: boolean;
  onComplete: (task: Task) => void;
  onRename: (task: Task, title: string) => void;
  onSelect?: (task: Task) => void;
}) {
  const due = dueDateOf(task, timeZone);
  const label = due ? formatDue(due, today) : null;
  const onRowClick = (e: MouseEvent<HTMLLIElement>) => {
    if (onSelect && !(e.target as Element).closest(".task-check, .task-title")) onSelect(task);
  };
  return (
    <li className={pending ? "task-row pending" : "task-row"} data-depth={depth} style={{ "--depth": depth } as CSSProperties} onClick={onRowClick}>
      <input type="checkbox" className="task-check" aria-label={`Complete ${task.title}`} checked={false} disabled={pending} onChange={() => onComplete(task)} />
      <TaskTitle task={task} onRename={onRename} />
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
