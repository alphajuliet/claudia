import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { Task } from "@claudia/shared";
import { type TaskCreate, useCreateTask, useDeleteTask, useLists, useMoveTask, usePendingCompletions, useSetCompleted, useTask, useTimeZone, useUpdateTask } from "../data/queries";
import { formatDue, todayIn } from "../lib/dates";
import { wrapIndex } from "../lib/keymap";
import { displayItems, indentMove, moveFor, outdentMove, placeOf, stepMove, withoutDragged, type Item, type MoveRequest } from "../lib/reorder";
import { collapseRows, dueDateOf, parentsIn, rowsUnder, type Row } from "../lib/tasks";
import { setCollapsed, useCollapsed } from "./collapsed";
import { BottomSheet } from "./BottomSheet";
import { DueField, SnoozeField } from "./DateFields";
import { useCommand } from "./keyboard";
import { InlineMarkdown, plainText } from "./Markdown";
import { Disclosure, RENAME_EVENT, TaskRow } from "./TaskRow";
import { markMade, requestEdit, useSelectedTask, type PendingField } from "./selection";
import { useToast } from "./Toast";
import { useDrag, type DragTarget } from "./useDrag";

/**
 * A run of rows, under a title (a list name in a view, a heading in a list) or none. A heading's title selects it,
 * as a row would. `aside` follows the title, and `placeholder` stands in for rows when there are none.
 */
export interface Section { key: string; title?: string; heading?: Task; rows: Row[]; aside?: ReactNode; placeholder?: ReactNode }

interface QueryState { isPending: boolean; error: Error | null; refetch: () => unknown }

/** Completes a task from its checkbox (or reopens a completed one) and reports the outcome in the toast. */
export function useComplete() {
  const setCompleted = useSetCompleted();
  const toast = useToast();
  const timeZone = useTimeZone();
  return async (task: Task) => {
    if (task.completedAt) {
      try {
        await setCompleted.mutateAsync({ task, done: false });
        toast.show({ message: `Reopened “${plainText(task.title)}”` });
      } catch (e) {
        toast.show({ message: (e as Error).message, error: true });
      }
      return;
    }
    try {
      const saved = await setCompleted.mutateAsync({ task, done: true });
      const nextDue = saved.completedAt ? null : dueDateOf(saved, timeZone);
      if (nextDue) {
        toast.show({ message: `Next due ${formatDue(nextDue, todayIn(timeZone)).text}` });
        return;
      }
      toast.show({
        message: `Completed “${plainText(task.title)}”${saved.subtasks > 0 ? ` and ${saved.subtasks} ${saved.subtasks === 1 ? "subtask" : "subtasks"}` : ""}`,
        undo: () => {
          setCompleted.mutateAsync({ task: saved, done: false }).catch((e: Error) => toast.show({ message: e.message, error: true }));
        },
      });
    } catch (e) {
      toast.show({ message: (e as Error).message, error: true });
    }
  };
}

/**
 * Deletes a task and its subtasks after asking (there's no undo), reporting the outcome in the toast. `onGone` runs
 * once the user has said yes, before the task leaves the screen (the panel closes with it). False if they said no.
 */
export function useDelete() {
  const remove = useDeleteTask();
  const toast = useToast();
  return (task: Task, onGone?: () => void): boolean => {
    const title = plainText(task.title);
    if (!window.confirm(`Delete “${title}” and its subtasks? This can't be undone.`)) return false;
    onGone?.();
    remove.mutateAsync({ task }).then(
      () => toast.show({ message: `Deleted “${title}”` }),
      (e: Error) => toast.show({ message: e.message, error: true }),
    );
    return true;
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
  onToggle: (task: Task, collapsed: boolean) => void;
  /** The row swiped open to show Date and Snooze. */
  openId: string | null;
  onReveal: (task: Task) => void;
  onCloseActions: () => void;
  onDate: (task: Task) => void;
  onSnooze: (task: Task) => void;
  rowNote?: (task: Task) => string | undefined;
}

/** A section as shown: `rows` without collapsed parts, `all` with them, and which tasks have subtasks. */
interface ShownSection extends Section { all: Row[]; parents: Set<string>; collapsed: Set<string> }

/** Rows whose completion is running, or whose parent's is (a subtask is completed with its parent). */
function pendingRows(rows: Row[], pending: Set<string>): Set<string> {
  const out = new Set<string>();
  let under = Infinity;
  for (const r of rows) {
    if (r.depth <= under) under = Infinity;
    if (pending.has(r.task.id) || r.depth > under) {
      out.add(r.task.id);
      if (under === Infinity) under = r.depth;
    }
  }
  return out;
}

/** A task made with `n t` or `n s` has a title until you give it one: the API needs one. */
const NEW_TASK_TITLE = "New task";
const NEW_HEADING_TITLE = "New heading";

/**
 * Where a new heading goes. After a task it starts a section there (after a subtask, its top-level task, as a heading
 * can't nest). On a heading it goes after that whole section, leaving it intact. With neither, it goes last.
 */
function headingPlace(order: Task[], target: Task | undefined): { afterId?: string; beforeId?: string } {
  if (!target) return {};
  if (target.kind === "heading") {
    const next = order.slice(order.indexOf(target) + 1).find((t) => t.kind === "heading");
    return next ? { beforeId: next.id } : {};
  }
  let top = target;
  while (top.parentId) {
    const parent = order.find((t) => t.id === top.parentId);
    if (!parent) break;
    top = parent;
  }
  return { afterId: top.id };
}

function TaskSection({ section, pending: pendingIds, selectedId, highlightId, openId, rowNote, ...rest }: RowProps & { section: ShownSection }) {
  const { heading } = section;
  const id = useId();
  const pending = pendingRows(section.all, pendingIds);
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
          expandable={section.parents.has(r.task.id)}
          collapsed={section.collapsed.has(r.task.id)}
          open={r.task.id === openId}
          note={rowNote?.(r.task)}
          {...rest}
        />
      ))}
    </ul>
  );
  if (!section.title) return rows;
  return (
    <section className="task-section" aria-labelledby={id}>
      <h2 className="section-title">
        {heading && section.all.length > 0 && (
          <Disclosure title={heading.title} collapsed={section.collapsed.has(heading.id)} onToggle={(c) => rest.onToggle(heading, c)} />
        )}
        {heading ? (
          <button
            id={id}
            type="button"
            className={["section-title-button", heading.id === selectedId && "selected", heading.id === highlightId && "highlighted"].filter(Boolean).join(" ")}
            aria-current={heading.id === selectedId ? "true" : undefined}
            data-task-id={heading.id}
            onFocus={() => rest.onHighlight(heading)}
            onClick={() => rest.onSelect(heading)}
          >
            <InlineMarkdown text={section.title} links={false} />
          </button>
        ) : <span id={id}>{section.title}</span>}
        {section.aside && <span className="section-aside">{section.aside}</span>}
      </h2>
      {section.rows.length > 0 ? rows : section.placeholder}
    </section>
  );
}

/** Puts the cursor at the end of the open panel's title. False when no panel is showing. */
export function focusPanelTitle(): boolean {
  const input = document.querySelector<HTMLInputElement>(".detail-title-input");
  if (!input) return false;
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  return true;
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

  // A screen starts on its first row, so there is somewhere to move from. Not on a touch screen, where a highlight
  // has no key to follow, and not when a task is already open (j and k start from that one).
  useEffect(() => {
    if (highlightId || selectedId || order.length === 0 || window.matchMedia?.("(pointer: coarse)").matches) return;
    setState({ path: location, id: order[0]!.id });
  }, [ids, highlightId, selectedId, location]);

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

  /** Highlights a task and focuses its row; the open panel follows. */
  const goTo = (t: Task) => {
    highlight(t);
    focusTask(t.id);
    if (selectedId && selectedId !== t.id) select(t.id, { follow: true });
  };

  return { highlightId, current, highlight, move, goTo };
}

/** Which sheet is up, for which task. */
interface Sheet { kind: "due" | "snooze"; id: string }

/**
 * The Due or Snooze sheet from a row's swipe. It shows the task as cached now, so a change shows at once; a quick
 * choice closes it.
 */
function RowSheet({ sheet, timeZone, onClose }: { sheet: Sheet; timeZone: string; onClose: () => void }) {
  const { data } = useTask(sheet.id);
  const task = data?.[0];
  return (
    <BottomSheet title={sheet.kind === "due" ? "Due" : "Snooze"} onClose={onClose}>
      {!task ? <p className="muted">{data ? "This task no longer exists." : "Loading…"}</p>
        : sheet.kind === "due" ? <DueField task={task} timeZone={timeZone} onQuick={onClose} />
        : <SnoozeField task={task} timeZone={timeZone} onClose={onClose} />}
    </BottomSheet>
  );
}

/**
 * The row swiped open to show Date and Snooze: one at a time. A press outside it or a scroll anywhere closes it.
 */
function useOpenRow() {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!openId) return;
    const close = () => setOpenId(null);
    const onPress = (e: PointerEvent) => {
      const inside = e.target instanceof Element && e.target.closest(`[data-task-id="${CSS.escape(openId)}"]`);
      if (!inside) close();
    };
    document.addEventListener("pointerdown", onPress, true);
    // Scroll events don't bubble: listen in the capture phase to hear any scroller.
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [openId]);
  return { openId, setOpenId };
}

/** Moves the highlighted task (J, K, Alt+↑ and Alt+↓) and indents it (L, H), keeping focus on it as its row moves (or remounts) elsewhere. */
function useStepMove(sections: ShownSection[], current: Task | undefined, order: Task[], enabled: boolean, arrowsHere: (e: KeyboardEvent) => boolean) {
  const move = useMoveTask();
  const toast = useToast();
  // The task last moved from the keyboard: its row gets focus back if the move took it away.
  const moved = useRef<string | null>(null);
  const ids = order.map((t) => t.id).join(" ");
  useEffect(() => {
    const id = moved.current;
    if (!id || !current || current.id !== id) return;
    if (document.activeElement === document.body || !document.activeElement) focusTask(id);
  }, [ids]); // when the rows change
  // Once the highlight goes elsewhere, it is an ordinary row again.
  useEffect(() => {
    if (current?.id !== moved.current) moved.current = null;
  }, [current?.id]);

  const step = (direction: -1 | 1) => (e: KeyboardEvent) => {
    if (!enabled || !current || !arrowsHere(e)) return false;
    const request = stepMove(displayItems(sections), current, direction);
    // At the end of the line the key is still ours: it does nothing.
    if (!request) return;
    moved.current = current.id;
    move.mutateAsync({ id: current.id, ...request }).catch((err: Error) => toast.show({ message: err.message, error: true }));
  };
  useCommand("moveUp", step(-1));
  useCommand("moveDown", step(1));

  const send = (request: MoveRequest) => {
    if (!current) return;
    moved.current = current.id;
    move.mutateAsync({ id: current.id, ...request }).catch((err: Error) => toast.show({ message: err.message, error: true }));
  };
  // Like the moves above, these are only for a list, and at the end of the line the key does nothing.
  useCommand("indent", () => {
    if (!enabled || !current) return false;
    const request = indentMove(displayItems(sections), current);
    if (!request) return;
    // Or the task would go out of sight inside its new parent.
    setCollapsed(request.parentId, false);
    send(request);
  });
  useCommand("outdent", () => {
    if (!enabled || !current) return false;
    const request = outdentMove(displayItems(sections), current);
    if (request) send(request);
  });
}

/**
 * Moves a dragged task to where it was dropped. A drop where it already was sends nothing. Dropped on another list,
 * it goes to the end there at the top level (a heading with its section), and the toast's Undo puts it back.
 */
function useDropMove(listId: string | undefined) {
  const move = useMoveTask();
  const toast = useToast();
  const lists = useLists().data;
  return (task: Task, target: DragTarget, items: Item[]) => {
    const fail = (e: Error) => toast.show({ message: e.message, error: true });
    if (target.kind === "list") {
      if (!listId) return;
      const section = task.kind === "heading" ? { withSection: true as const } : {};
      const back = { ...placeOf(items, task), listId, ...section };
      const name = lists?.find((l) => l.id === target.listId)?.name ?? "another list";
      move.mutateAsync({ id: task.id, listId: target.listId, parentId: null, ...section }).catch(fail);
      toast.show({ message: `Moved “${plainText(task.title)}” to ${name}`, undo: () => { move.mutateAsync({ id: task.id, ...back }).catch(fail); } });
      return;
    }
    const request = moveFor(withoutDragged(items, task), task, target, items);
    if (request) move.mutateAsync({ id: task.id, ...request }).catch(fail);
  };
}

/**
 * Task rows in sections, with loading, error and empty states. With `reorder` (a list screen), rows and headings
 * drag with the mouse, and the keys move and indent the highlighted task.
 */
export function TaskList({ query, sections, empty, reorder, split, rowNote }: {
  query: QueryState;
  sections: Section[];
  empty: string;
  reorder?: { listId: string };
  /** Sections before this index go in a first column, and the rest in a second. */
  split?: number;
  rowNote?: (task: Task) => string | undefined;
}) {
  const timeZone = useTimeZone();
  const today = todayIn(timeZone);
  const complete = useComplete();
  const onRename = useRename();
  const pending = usePendingCompletions();
  const { selectedId, select } = useSelectedTask();
  const shown = !query.error && !query.isPending;
  const collapsed = useCollapsed();
  const shownSections: ShownSection[] = sections.map((s) => ({
    ...s,
    all: s.rows,
    rows: s.heading && collapsed.has(s.heading.id) ? [] : collapseRows(s.rows, collapsed),
    parents: parentsIn(s.rows),
    collapsed,
  }));
  const order = shown ? shownSections.flatMap((s) => [...(s.heading ? [s.heading] : []), ...s.rows.map((r) => r.task)]) : [];
  const { highlightId, current, highlight, move, goTo } = useHighlight(order);
  const { openId, setOpenId } = useOpenRow();
  // Completing or reopening the open row (its checkbox, a swipe) closes it, so it doesn't spring open again later.
  const onComplete = (t: Task) => {
    if (t.id === openId) setOpenId(null);
    return complete(t);
  };
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const openSheet = (kind: Sheet["kind"]) => (t: Task) => {
    setOpenId(null);
    setSheet({ kind, id: t.id });
  };
  // Focus goes back to the row (if it's still there: a snooze takes it away).
  const closeSheet = () => {
    if (sheet) focusTask(sheet.id, true);
    setSheet(null);
  };

  /** The section a task shows in (as its heading or a row). */
  const sectionOf = (t: Task) => shownSections.find((s) => s.heading?.id === t.id || s.rows.some((r) => r.task.id === t.id));
  const canCollapse = (t: Task) => {
    const s = sectionOf(t);
    return Boolean(s && (s.heading?.id === t.id ? s.all.length > 0 : s.parents.has(t.id)));
  };
  // Collapsing over the highlighted row hands the highlight (and focus, if the row had it) to the collapsed item.
  const toggle = (t: Task, value: boolean) => {
    if (value && highlightId) {
      const s = sectionOf(t);
      const under = s?.heading?.id === t.id ? s.all.map((r) => r.task.id) : shownSections.flatMap((x) => rowsUnder(x.all, t.id));
      if (under.includes(highlightId)) {
        const hadFocus = document.activeElement?.closest("[data-task-id]")?.getAttribute("data-task-id") === highlightId;
        highlight(t);
        if (hadFocus) focusTask(t.id);
      }
    }
    setCollapsed(t.id, value);
  };

  useCommand("collapse", () => {
    if (!current) return false;
    if (canCollapse(current) && !collapsed.has(current.id)) return void toggle(current, true);
    // Already collapsed, or nothing under it: go to its parent task, or the heading it sits under.
    const s = sectionOf(current);
    const parent = current.parentId ? order.find((t) => t.id === current.parentId) : undefined;
    const up = parent ?? (current.kind === "task" ? s?.heading : undefined);
    if (up) goTo(up);
  });
  useCommand("expand", () => {
    // A task whose subtasks aren't on this screen keeps its state for the screens where they are.
    if (!current || !canCollapse(current) || !collapsed.has(current.id)) return false;
    setCollapsed(current.id, false);
  });

  // Arrow keys keep their usual meaning (radios, scrolling the panel) outside the list.
  const arrowsHere = (e: KeyboardEvent) =>
    !e.key.startsWith("Arrow") || e.target === document.body || (e.target instanceof Element && e.target.closest("main") !== null);
  useCommand("next", (e) => arrowsHere(e) && move(1));
  useCommand("previous", (e) => arrowsHere(e) && move(-1));
  useStepMove(shownSections, current, order, reorder !== undefined, arrowsHere);
  const drag = useDrag({ listId: shown ? reorder?.listId : undefined, items: displayItems(shownSections), onDrop: useDropMove(reorder?.listId) });
  useCommand("open", (e) => {
    if (!current) return false;
    // Enter on a button or link keeps its own meaning: it opens only from the row itself (or nothing focused).
    const active = document.activeElement;
    if (e.key === "Enter" && !(active === document.body || active?.getAttribute("data-task-id") === current.id)) return false;
    // Already open: Enter again goes on to the title.
    if (e.key === "Enter" && selectedId === current.id && focusPanelTitle()) return;
    select(current.id);
  });
  useCommand("complete", () => {
    if (!current || current.kind !== "task") return false;
    if (!pending.has(current.id)) void onComplete(current);
  });
  const update = useUpdateTask();
  const setPriority = (priority: Task["priority"]) => () => {
    if (current?.kind !== "task") return false;
    if (current.priority !== priority) update.mutateAsync({ id: current.id, patch: { priority } }).catch((e: Error) => toast.show({ message: e.message, error: true }));
  };
  useCommand("priorityHigh", setPriority("high"));
  useCommand("priorityNormal", setPriority("normal"));
  useCommand("priorityLow", setPriority("low"));
  const onDelete = useDelete();
  useCommand("delete", () => {
    if (!current) return false;
    onDelete(current, () => { if (selectedId === current.id) select(null); });
  });
  // n t and n s make the task and open its panel to fill in; closing it untouched takes the task away again (`Shell`).
  const create = useCreateTask();
  const toast = useToast();
  const make = (fields: TaskCreate) => {
    if (create.isPending) return;
    create.mutateAsync(fields).then((saved) => {
      markMade(saved);
      select(saved.id);
    }, (e: Error) => toast.show({ message: e.message, error: true }));
  };
  // The highlighted task, or the one open in the panel.
  const target = current ?? order.find((t) => t.id === selectedId);
  useCommand("newTask", () => {
    if (!target) return false;
    if (target.kind === "heading") setCollapsed(target.id, false); // It goes first in the section.
    make({ listId: target.listId, parentId: target.parentId, afterId: target.id, title: NEW_TASK_TITLE });
  });
  useCommand("newSubtask", () => {
    if (!target) return false;
    // A heading can't have subtasks, and one under a completed task would be out of sight.
    if (target.kind === "heading" || target.completedAt) return;
    setCollapsed(target.id, false);
    make({ listId: target.listId, parentId: target.id, title: NEW_TASK_TITLE });
  });
  // Headings need a list, and only a list screen shows them.
  useCommand("newHeading", reorder ? () => {
    make({ listId: reorder.listId, parentId: null, kind: "heading", title: NEW_HEADING_TITLE, ...headingPlace(order, target) });
  } : undefined);
  // e n and e l with the panel closed: open the highlighted task's panel on that field. (With the panel open, its
  // fields take these first.)
  const editIn = (field: PendingField) => () => {
    if (!current || current.kind !== "task") return false;
    requestEdit(current.id, field);
    select(current.id);
  };
  useCommand("editNotes", editIn("notes"));
  useCommand("editLabels", editIn("labels"));
  useCommand("rename", () => {
    if (document.querySelector(".detail-title-input")) return false; // The panel's title takes it.
    const title = current?.kind === "task" && document.querySelector<HTMLElement>(`main [data-task-id="${CSS.escape(current.id)}"] .task-title`);
    if (!title) return false;
    title.dispatchEvent(new Event(RENAME_EVENT));
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
  const sectionViews = shownSections.map((s) => (
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
      onToggle={toggle}
      openId={openId}
      onReveal={(t) => setOpenId(t.id)}
      onCloseActions={() => setOpenId(null)}
      onDate={openSheet("due")}
      onSnooze={openSheet("snooze")}
      rowNote={rowNote}
    />
  ));
  return (
    <div className={split === undefined ? "task-sections" : "task-sections split"} ref={drag.ref} onPointerDown={drag.onPointerDown}>
      {sheet && <RowSheet sheet={sheet} timeZone={timeZone} onClose={closeSheet} />}
      {split === undefined ? sectionViews : (
        <>
          <div className="task-column">{sectionViews.slice(0, split)}</div>
          <div className="task-column">{sectionViews.slice(split)}</div>
        </>
      )}
    </div>
  );
}
