import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { Task } from "@claudia/shared";
import { usePendingCompletions, useSetCompleted, useTimeZone, useUpdateTask } from "../data/queries";
import { formatDue, todayIn } from "../lib/dates";
import { wrapIndex } from "../lib/keymap";
import type { Row } from "../lib/tasks";
import { useCommand } from "./keyboard";
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
  highlightId: string | null;
  onComplete: (task: Task) => void;
  onRename: (task: Task, title: string) => void;
  onSelect: (task: Task) => void;
  onHighlight: (task: Task) => void;
}

function TaskSection({ section, pending, selectedId, highlightId, ...rest }: RowProps & { section: Section }) {
  const { heading } = section;
  const id = useId();
  const rows = (
    <ul className="task-list">
      {section.rows.map((r) => (
        <TaskRow
          key={r.task.id}
          task={r.task}
          depth={r.depth}
          pending={pending.has(r.task.id)}
          selected={r.task.id === selectedId}
          highlighted={r.task.id === highlightId}
          {...rest}
        />
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
            className={["section-title-button", heading.id === selectedId && "selected", heading.id === highlightId && "highlighted"].filter(Boolean).join(" ")}
            aria-current={heading.id === selectedId ? "true" : undefined}
            data-task-id={heading.id}
            onFocus={() => rest.onHighlight(heading)}
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

/** Focuses the row (or heading) showing a task, if it's on screen. */
export function focusTask(id: string, preventScroll = false) {
  document.querySelector<HTMLElement>(`main [data-task-id="${CSS.escape(id)}"]`)?.focus({ preventScroll });
}

/**
 * The keyboard highlight: the row that last had focus, on this screen. j and k move it (wrapping at the ends) and,
 * while the panel is open, the panel follows. When the highlighted task leaves the list, the row now in its place
 * takes over.
 */
function useHighlight(order: Task[]) {
  const [location] = useLocation();
  const [state, setState] = useState<{ path: string; id: string } | null>(null);
  const highlightId = state?.path === location ? state.id : null;
  const { selectedId, select } = useSelectedTask();
  const lastIndex = useRef(-1);
  const ids = order.map((t) => t.id).join(" ");

  const highlight = (t: Task) => setState({ path: location, id: t.id });

  // A new screen starts without a highlight (views share one list, so it isn't remounted).
  const shownAt = useRef(location);
  useEffect(() => {
    if (shownAt.current === location) return;
    shownAt.current = location;
    setState(null);
  }, [location]);

  useEffect(() => {
    if (!highlightId) return;
    const i = order.findIndex((t) => t.id === highlightId);
    if (i >= 0) {
      lastIndex.current = i;
      return;
    }
    const next = order[Math.min(lastIndex.current, order.length - 1)];
    if (!next) {
      setState(null);
      return;
    }
    setState({ path: location, id: next.id });
    // The old row took focus with it when it went: give it to the row now in its place, without scrolling (the
    // change may have come from elsewhere).
    if (document.activeElement === document.body || !document.activeElement) focusTask(next.id, true);
  }, [ids, highlightId]); // when the rows or the highlight change

  const move = (delta: 1 | -1) => {
    if (order.length === 0) return false;
    const i = highlightId ? order.findIndex((t) => t.id === highlightId) : -1;
    // With no highlight yet, start at the task whose details are showing, if it's here.
    const start = !highlightId && selectedId ? order.findIndex((t) => t.id === selectedId) : -1;
    const t = order[start >= 0 ? start : wrapIndex(i, order.length, delta)]!;
    highlight(t);
    focusTask(t.id);
    if (selectedId && selectedId !== t.id) select(t.id, { follow: true });
    return true;
  };
  const current = highlightId ? order.find((t) => t.id === highlightId) : undefined;

  return { highlightId, current, highlight, move };
}

/** Task rows in sections, with loading, error and empty states. */
export function TaskList({ query, sections, empty }: { query: QueryState; sections: Section[]; empty: string }) {
  const timeZone = useTimeZone();
  const today = todayIn(timeZone);
  const onComplete = useComplete();
  const onRename = useRename();
  const pending = usePendingCompletions();
  const { selectedId, select } = useSelectedTask();
  const shown = !query.error && !query.isPending;
  const order = shown ? sections.flatMap((s) => [...(s.heading ? [s.heading] : []), ...s.rows.map((r) => r.task)]) : [];
  const { highlightId, current, highlight, move } = useHighlight(order);

  // Arrow keys keep their usual meaning (radios, scrolling the panel) outside the list.
  const arrowsHere = (e: KeyboardEvent) =>
    !e.key.startsWith("Arrow") || e.target === document.body || (e.target instanceof Element && e.target.closest("main") !== null);
  useCommand("next", (e) => arrowsHere(e) && move(1));
  useCommand("previous", (e) => arrowsHere(e) && move(-1));
  useCommand("open", (e) => {
    if (!current) return false;
    // Enter on a button or link keeps its own meaning: it opens only from the row itself (or nothing focused).
    const active = document.activeElement;
    if (e.key === "Enter" && !(active === document.body || active?.getAttribute("data-task-id") === current.id)) return false;
    select(current.id);
  });
  useCommand("complete", () => {
    if (!current || current.kind !== "task") return false;
    if (!pending.has(current.id)) void onComplete(current);
  });
  useCommand("rename", () => {
    const title = current?.kind === "task" && document.querySelector<HTMLElement>(`main [data-task-id="${CSS.escape(current.id)}"] .task-title`);
    if (!title) return false;
    title.click();
  });

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
          highlightId={highlightId}
          onComplete={onComplete}
          onRename={onRename}
          onSelect={(t) => select(t.id)}
          onHighlight={highlight}
        />
      ))}
    </div>
  );
}
