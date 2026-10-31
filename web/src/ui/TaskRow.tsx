import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { Task } from "@claudia/shared";
import { formatDue, todayIn } from "../lib/dates";
import { InlineMarkdown, plainText } from "./Markdown";

/** The task's due date (YYYY-MM-DD): its date, or the day of its due time in the user's time zone. */
export const dueDateOf = (task: Task, timeZone: string) =>
  task.dueDate ?? (task.dueAt ? todayIn(timeZone, new Date(task.dueAt)) : null);

/**
 * The title (inline Markdown), as a button that turns into a text input showing the raw text. Enter or leaving the field saves a changed,
 * non-empty title through `onRename`; Escape cancels. After a keyboard save or cancel, focus returns to the title.
 */
function TaskTitle({ task, onRename }: { task: Task; onRename: (task: Task, title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const refocus = useRef(false);
  const button = useRef<HTMLSpanElement>(null);

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
    const edit = () => {
      done.current = false;
      setDraft(task.title);
    };
    // A span acting as a button rather than a <button>, so links in the title can be clicked.
    return (
      <span
        ref={button}
        role="button"
        tabIndex={0}
        className="task-title"
        onClick={edit}
        onKeyDown={(e) => {
          // Keys on a link inside the title are the link's.
          if (e.target !== e.currentTarget) return;
          if ((e.key === "Enter" || e.key === " ") && !e.nativeEvent.isComposing) {
            e.preventDefault();
            edit();
          }
        }}
      >
        <InlineMarkdown text={task.title} />
      </span>
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
 * `onSelect` is called for clicks on the row outside the checkbox and title (it opens the detail panel); `selected`
 * marks the row whose details are showing. The row can take focus (the keyboard highlight), and focus anywhere in
 * it calls `onHighlight`.
 */
/** The ▸/▾ toggle of a heading or a task with subtasks. */
export function Disclosure({ title, collapsed, onToggle }: { title: string; collapsed: boolean; onToggle: (collapsed: boolean) => void }) {
  return (
    <button
      type="button"
      className="disclosure"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${plainText(title)}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!collapsed);
      }}
    >
      <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
    </button>
  );
}

export function TaskRow({ task, depth, today, timeZone, pending, selected = false, highlighted = false, expandable = false, collapsed = false, onComplete, onRename, onSelect, onHighlight, onToggle }: {
  task: Task;
  depth: number;
  today: string;
  timeZone: string;
  pending: boolean;
  selected?: boolean;
  highlighted?: boolean;
  /** It has subtasks, so it shows a toggle; `collapsed` hides them. */
  expandable?: boolean;
  collapsed?: boolean;
  onComplete: (task: Task) => void;
  onRename: (task: Task, title: string) => void;
  onSelect?: (task: Task) => void;
  onHighlight?: (task: Task) => void;
  onToggle?: (task: Task, collapsed: boolean) => void;
}) {
  const due = dueDateOf(task, timeZone);
  const label = due ? formatDue(due, today) : null;
  const onRowClick = (e: MouseEvent<HTMLLIElement>) => {
    if (onSelect && !(e.target as Element).closest(".task-check, .task-title, .disclosure")) onSelect(task);
  };
  return (
    <li
      className={["task-row", pending && "pending", selected && "selected", highlighted && "highlighted", task.completedAt && "completed"].filter(Boolean).join(" ")}
      aria-current={selected ? "true" : undefined}
      tabIndex={-1}
      data-task-id={task.id}
      onFocus={() => onHighlight?.(task)}
      data-depth={depth} style={{ "--depth": depth } as CSSProperties} onClick={onRowClick}>
      {expandable && <Disclosure title={task.title} collapsed={collapsed} onToggle={(c) => onToggle?.(task, c)} />}
      <input
        type="checkbox"
        className="task-check"
        aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${plainText(task.title)}`}
        checked={task.completedAt !== null}
        disabled={pending}
        onChange={() => onComplete(task)}
      />
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
