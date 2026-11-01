import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Task } from "@claudia/shared";
import { formatDue } from "../lib/dates";
import { dueDateOf } from "../lib/tasks";
import { InlineMarkdown, plainText } from "./Markdown";
import { useSwipe } from "./useSwipe";

/**
 * The title (inline Markdown), as a button that turns into a text input showing the raw text. Enter or leaving the field saves a changed,
 * non-empty title through `onRename`; Escape cancels. After a keyboard save or cancel, focus returns to the title.
 * A tap (the row's last pointer was touch or pen) calls `onOpen` instead, when given, so a phone opens the task
 * rather than bringing up the keyboard.
 */
function TaskTitle({ task, onRename, onOpen, pointerType }: {
  task: Task;
  onRename: (task: Task, title: string) => void;
  onOpen?: () => void;
  pointerType: RefObject<string | null>;
}) {
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
        onClick={() => {
          const type = pointerType.current;
          if (onOpen && (type === "touch" || type === "pen")) onOpen();
          else edit();
        }}
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

/**
 * One task. While `pending` (a complete or reopen is running), its checkbox is disabled so a double click sends one.
 * `onSelect` is called for clicks on the row outside the checkbox and title, and for taps on the title (it opens the detail panel); `selected`
 * marks the row whose details are showing. The row can take focus (the keyboard highlight), and focus anywhere in
 * it calls `onHighlight`. On touch, a swipe right completes or reopens it, as the checkbox does (`useSwipe`); on an
 * open task, a swipe left calls `onReveal`, and while `open` the row shows Date and Snooze (`onDate`, `onSnooze`).
 * Keyboard and screen-reader users have the panel for those, so the buttons are hidden from them while closed.
 */
export function TaskRow({ task, depth, today, timeZone, pending, selected = false, highlighted = false, expandable = false, collapsed = false, open = false, onComplete, onRename, onSelect, onHighlight, onToggle, onReveal, onCloseActions, onDate, onSnooze }: {
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
  /** Date and Snooze are showing (swiped left). */
  open?: boolean;
  onReveal?: (task: Task) => void;
  onCloseActions?: () => void;
  onDate?: (task: Task) => void;
  onSnooze?: (task: Task) => void;
}) {
  const due = dueDateOf(task, timeZone);
  const label = due ? formatDue(due, today) : null;
  // The pointer type of the last press in the row: a tap on the title opens the task instead of renaming it.
  const pointerType = useRef<string | null>(null);
  const allowLeft = Boolean(onDate && onSnooze) && task.kind === "task" && !task.completedAt;
  const swipe = useSwipe<HTMLLIElement>({
    onComplete: () => onComplete(task),
    onReveal: onReveal && (() => onReveal(task)),
    onCloseActions,
    open: open && allowLeft,
    allowLeft,
    disabled: pending,
  });
  const shown = open && allowLeft;
  const title = plainText(task.title);
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
      {...swipe}
      onPointerDown={(e) => {
        pointerType.current = e.pointerType;
        swipe.onPointerDown(e);
      }}
      data-depth={depth} style={{ "--depth": depth } as CSSProperties} onClick={onRowClick}>
      {/* Behind the row, shown as it's swiped right. The checkbox does the same, so it's hidden from assistive tech. */}
      <span className="swipe-complete" aria-hidden="true">{task.completedAt ? "Reopen" : "Complete"}</span>
      {/* On the right, shown as it's swiped left. */}
      {allowLeft && (
        <span className="swipe-actions" aria-hidden={shown ? undefined : "true"}>
          <button type="button" className="swipe-date" tabIndex={shown ? undefined : -1} aria-label={`Date for ${title}`}
            onClick={(e) => { e.stopPropagation(); onDate?.(task); }}>Date</button>
          <button type="button" className="swipe-snooze" tabIndex={shown ? undefined : -1} aria-label={`Snooze ${title}`}
            onClick={(e) => { e.stopPropagation(); onSnooze?.(task); }}>Snooze</button>
        </span>
      )}
      <div className="task-row-body">
        {expandable && <Disclosure title={task.title} collapsed={collapsed} onToggle={(c) => onToggle?.(task, c)} />}
        <input
          type="checkbox"
          className="task-check"
          aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${title}`}
          checked={task.completedAt !== null}
          disabled={pending}
          onChange={() => onComplete(task)}
        />
        <TaskTitle task={task} onRename={onRename} onOpen={onSelect && (() => onSelect(task))} pointerType={pointerType} />
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
      </div>
    </li>
  );
}
