import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Task } from "@claudia/shared";
import { useCreateTask, useDeleteTask, usePendingCompletions, useTask, useTasks, useTimeZone } from "../data/queries";
import { useComplete } from "./TaskList";
import { DateFields, FieldStatus, LabelsField, ListField, NotesField, RepeatField, TitleField, useSave } from "./TaskFields";
import { useToast } from "./Toast";

/** The task's open subtasks, each with a checkbox, and a field that adds one to the end. */
function Subtasks({ task }: { task: Task }) {
  const children = useTasks(new URLSearchParams({ parentId: task.id, status: "open" }).toString());
  const complete = useComplete();
  const pending = usePendingCompletions();
  const create = useCreateTask();
  const save = useSave();
  const [text, setText] = useState("");
  const headingId = useId();

  const add = () => {
    const title = text.trim();
    if (!title) return;
    setText("");
    void save.run(create.mutateAsync({ listId: task.listId, parentId: task.id, title })).then((ok) => {
      if (!ok) setText((now) => now || title);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    }
  };

  return (
    <section className="detail-subtasks" aria-labelledby={headingId}>
      <h3 id={headingId} className="detail-label">Subtasks</h3>
      <ul className="detail-subtask-list" aria-labelledby={headingId}>
        {(children.data ?? []).map((t) => (
          <li key={t.id} className={pending.has(t.id) ? "detail-subtask pending" : "detail-subtask"}>
            <input
              type="checkbox"
              className="task-check"
              aria-label={`Complete ${t.title}`}
              checked={false}
              disabled={pending.has(t.id)}
              onChange={() => void complete(t)}
            />
            <span className="detail-subtask-title">{t.title}</span>
          </li>
        ))}
      </ul>
      {children.error && <p className="field-error" role="alert">{children.error.message}</p>}
      <div className="detail-subtask-add">
        <span className="quick-add-plus" aria-hidden="true">+</span>
        <input
          type="text"
          className="detail-inline-input"
          aria-label="Add a subtask"
          placeholder="Add a subtask"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <FieldStatus state={save.state} />
    </section>
  );
}

/** Deletes the task and its subtasks after asking (there's no undo), closing the panel at once. */
function DeleteButton({ task, onClose }: { task: Task; onClose: () => void }) {
  const remove = useDeleteTask();
  const toast = useToast();
  const onClick = () => {
    if (!window.confirm(`Delete “${task.title}” and its subtasks? This can't be undone.`)) return;
    onClose();
    remove.mutateAsync({ task }).then(
      () => toast.show({ message: `Deleted “${task.title}”` }),
      (e: Error) => toast.show({ message: e.message, error: true }),
    );
  };
  return (
    <div className="detail-footer">
      <button type="button" className="quiet danger" onClick={onClick}>
        {task.kind === "heading" ? "Delete heading" : "Delete task"}
      </button>
    </div>
  );
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useTask(id);
  const timeZone = useTimeZone();
  const task = query.data?.[0];

  if (query.error) {
    return (
      <div className="detail-state" role="alert">
        <p>{query.error.message}</p>
        <button type="button" className="quiet" onClick={() => void query.refetch()}>Try again</button>
      </div>
    );
  }
  if (query.isPending) return <p className="detail-state muted">Loading…</p>;
  if (!task) return <p className="detail-state muted">This task no longer exists.</p>;
  if (task.kind === "heading") {
    return (
      <>
        <TitleField task={task} />
        <DeleteButton task={task} onClose={onClose} />
      </>
    );
  }
  return (
    <>
      <TitleField task={task} />
      <NotesField task={task} />
      <div className="detail-fields">
        <DateFields task={task} timeZone={timeZone} />
        <LabelsField task={task} />
        <ListField task={task} />
        <RepeatField task={task} />
      </div>
      <Subtasks task={task} />
      <DeleteButton task={task} onClose={onClose} />
    </>
  );
}

/**
 * The selected task's details beside the list (a sheet on narrow screens). Focus moves into it when it opens;
 * Escape inside it closes it, after the field being edited has saved.
 */
export function TaskDetail({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), [id]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    // Leaving the field saves it, as clicking elsewhere would.
    const active = document.activeElement;
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur();
    onClose();
  };

  return (
    <aside ref={ref} className="detail" aria-label="Task details" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="detail-header">
        <button type="button" className="quiet small" onClick={onClose}>Close</button>
      </header>
      <div className="detail-body">
        <Body id={id} onClose={onClose} />
      </div>
    </aside>
  );
}
