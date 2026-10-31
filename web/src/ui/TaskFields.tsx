import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Task } from "@claudia/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useFolders, useLabels, useLists, useMoveTask, useUpdateTask, type TaskPatch } from "../data/queries";
import { todayIn } from "../lib/dates";
import { PRESETS, presetFor, ruleFor, type Preset } from "../lib/repeat";
import { sidebarTree, type FolderNode } from "../lib/sidebar";
import { findInbox } from "../lib/views";
import { BlockMarkdown } from "./Markdown";
import { useToast, type ToastMessage } from "./Toast";

/*
 * Fields of the detail panel. Each saves on its own and says how that went beside itself. A failure also shows in the
 * toast, which is still there when the panel has closed.
 */

type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

const SAVED_MS = 2500;

/** Tracks one field's saves: only the latest one counts, and "Saved" fades after a moment. */
export function useSave() {
  const toast = useToast();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const latest = useRef(0);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const timer = setTimeout(() => setState((s) => (s.kind === "saved" ? { kind: "idle" } : s)), SAVED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  /**
   * Resolves true when the save worked; a failure shows beside the field and in the toast (with `action`, such as a way
   * to recover what was typed) rather than rejecting.
   */
  const run = (save: Promise<unknown>, action?: ToastMessage["action"]): Promise<boolean> => {
    const mine = ++latest.current;
    setState({ kind: "saving" });
    return save.then(
      () => {
        if (mine === latest.current) setState({ kind: "saved" });
        return true;
      },
      (e: Error) => {
        if (mine === latest.current) setState({ kind: "error", message: e.message });
        toast.show({ message: e.message, error: true, ...(action ? { action } : {}) });
        return false;
      },
    );
  };
  return { state, run };
}

export function FieldStatus({ state }: { state: SaveState }) {
  return (
    <>
      <span className="field-status" aria-live="polite">{state.kind === "saved" ? "Saved" : ""}</span>
      {state.kind === "error" && <span className="field-error" role="alert">{state.message}</span>}
    </>
  );
}

/** Saves a patch to the task, tracked by its own field status. */
function usePatch(task: Task) {
  const update = useUpdateTask();
  const save = useSave();
  return {
    state: save.state,
    patch: (patch: TaskPatch, action?: ToastMessage["action"]) => save.run(update.mutateAsync({ id: task.id, patch }), action),
  };
}

/** A toast action that copies `text`, where the browser allows it. */
const copyAction = (label: string, text: string): ToastMessage["action"] =>
  navigator.clipboard ? { label, run: () => void navigator.clipboard.writeText(text).catch(() => {}) } : undefined;

/** A labelled row: a small muted label on the left, the value beside it. */
function Field({ label, htmlFor, children, group = false }: { label: string; htmlFor?: string; children: ReactNode; group?: boolean }) {
  const id = useId();
  if (group) {
    return (
      <div className="detail-field" role="group" aria-labelledby={id}>
        <span id={id} className="detail-label">{label}</span>
        <div className="detail-value">{children}</div>
      </div>
    );
  }
  return (
    <div className="detail-field">
      <label className="detail-label" htmlFor={htmlFor}>{label}</label>
      <div className="detail-value">{children}</div>
    </div>
  );
}

const enterPressed = (e: KeyboardEvent) => e.key === "Enter" && !e.nativeEvent.isComposing;

/** The title, large. Saves on Enter or leaving the field; an empty title goes back to the saved one. */
export function TitleField({ task }: { task: Task }) {
  const { state, patch } = usePatch(task);
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft === null) return;
    const title = draft.trim();
    if (title && title !== task.title) void patch({ title });
    setDraft(null);
  };
  return (
    <div className="detail-title">
      <input
        type="text"
        className="detail-title-input"
        aria-label="Title"
        autoComplete="off"
        enterKeyHint="done"
        value={draft ?? task.title}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (enterPressed(e)) {
            e.preventDefault();
            finish();
          }
        }}
        onBlur={finish}
      />
      <FieldStatus state={state} />
    </div>
  );
}

/** Notes: a textarea that grows with its text and saves on leaving it. Empty notes are cleared. */
export function NotesField({ task }: { task: Task }) {
  const { state, patch } = usePatch(task);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = draft ?? task.notes ?? "";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);
  const finish = () => {
    setEditing(false);
    if (draft === null) return;
    const notes = draft.trim() ? draft : null;
    // A failure may come after the panel has closed, so the toast offers the text back.
    if (notes !== task.notes) void patch({ notes }, notes ? copyAction("Copy notes", notes) : undefined);
    setDraft(null);
  };
  const edit = () => {
    setEditing(true);
    // After the textarea replaces the formatted notes: focus it with the caret at the end.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  // Notes show formatted until clicked (links still open); empty notes are the editor already.
  const formatted = !editing && value.trim() !== "";
  return (
    <div className="detail-notes">
      {formatted ? (
        <div
          className="detail-notes-view"
          role="group"
          tabIndex={0}
          aria-label="Notes (click or press Enter to edit)"
          onClick={(e) => { if (!(e.target as Element).closest("a")) edit(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) {
              e.preventDefault();
              edit();
            }
          }}
        >
          <BlockMarkdown text={value} />
        </div>
      ) : (
        <textarea
          ref={ref}
          className="detail-notes-input"
          aria-label="Notes"
          placeholder="Notes"
          rows={2}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={finish}
        />
      )}
      <FieldStatus state={state} />
    </div>
  );
}

const DATE = /^(\d{4})-\d{2}-\d{2}$/;

const DATE_IDLE_MS = 600;

/**
 * A date picker with Clear. A complete date saves after a moment without changes, or on leaving the field, so
 * retyping a day sends one save. One whose year is still being typed (a browser's date field shows 0002, 0020, 0202
 * on the way to 2026) waits until leaving the field.
 */
function DateInput({ label, name, value, onSave, status }: {
  label: string;
  name: string;
  value: string | null;
  onSave: (date: string | null) => void;
  status: SaveState;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // The waiting save, bound to the task it was typed for.
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    clearTimeout(timer.current);
    pending.current = null;
  };
  const flush = () => {
    const run = pending.current;
    cancel();
    run?.();
  };
  const save = (date: string) => {
    const next = date === "" ? null : date;
    if (next !== value) onSave(next);
  };
  const later = (date: string) => {
    cancel();
    pending.current = () => {
      save(date);
      setDraft(null);
    };
    timer.current = setTimeout(flush, DATE_IDLE_MS);
  };
  // Closing the panel doesn't drop a date waiting to save.
  useEffect(() => flush, []);
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="date"
        className="detail-date"
        value={draft ?? value ?? ""}
        onChange={(e) => {
          const date = e.target.value;
          const year = DATE.exec(date)?.[1];
          setDraft(date);
          if (year && Number(year) >= 1900) later(date);
          else cancel();
        }}
        onBlur={() => {
          cancel();
          if (draft !== null && (draft === "" || DATE.test(draft))) save(draft);
          setDraft(null);
        }}
      />
      {value && (
        <button type="button" className="quiet small" aria-label={`Clear ${name}`} onClick={() => { cancel(); setDraft(null); onSave(null); }}>
          Clear
        </button>
      )}
      <FieldStatus state={status} />
    </Field>
  );
}

/** A due time as "3 Nov, 7:00 pm" in the user's time zone, with the year when it isn't this year. */
const formatDueAt = (iso: string, timeZone: string) => {
  const at = new Date(iso);
  const sameYear = todayIn(timeZone, at).slice(0, 4) === todayIn(timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
};

/** Due and start dates. A task due at a time shows it read-only, with Clear; times aren't edited here. */
export function DateFields({ task, timeZone }: { task: Task; timeZone: string }) {
  const due = usePatch(task);
  const start = usePatch(task);
  return (
    <>
      {task.dueAt && !task.dueDate ? (
        <Field label="Due" group>
          <span className="detail-text">{formatDueAt(task.dueAt, timeZone)}</span>
          <button type="button" className="quiet small" aria-label="Clear due date" onClick={() => void due.patch({ dueAt: null })}>
            Clear
          </button>
          <FieldStatus state={due.state} />
        </Field>
      ) : (
        <DateInput label="Due" name="due date" value={task.dueDate} status={due.state} onSave={(dueDate) => void due.patch({ dueDate })} />
      )}
      <DateInput label="Start" name="start date" value={task.startDate} status={start.state} onSave={(startDate) => void start.patch({ startDate })} />
    </>
  );
}

/**
 * Label chips with remove buttons, and a field that adds one on Enter or on leaving it (suggesting existing labels).
 * Each change sends the whole set, worked out from the task as cached now, so quick changes build on each other.
 */
export function LabelsField({ task }: { task: Task }) {
  const { state, patch } = usePatch(task);
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const listId = useId();
  const has = (labels: string[], name: string) => labels.some((l) => l.toLowerCase() === name.toLowerCase());
  const suggestions = (useLabels().data ?? []).filter((l) => !has(task.labels, l.name));
  const current = () => queryClient.getQueryData<Task[]>(["tasks", "one", task.id])?.[0]?.labels ?? task.labels;
  const add = () => {
    const name = text.trim().replace(/^#/, "");
    if (!name) return;
    setText("");
    const labels = current();
    if (has(labels, name)) return;
    void patch({ labels: [...labels, name] }).then((ok) => { if (!ok) setText((now) => now || name); });
  };
  return (
    <Field label="Labels" group>
      {task.labels.length > 0 && (
        <ul className="detail-chips">
          {task.labels.map((l) => (
            <li key={l} className="chip chip-removable">
              {l}
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove label ${l}`}
                onClick={() => void patch({ labels: current().filter((x) => x !== l) })}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="text"
        className="detail-inline-input"
        aria-label="Add a label"
        placeholder="Add a label"
        list={listId}
        autoComplete="off"
        enterKeyHint="done"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (enterPressed(e)) {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      <datalist id={listId}>
        {suggestions.map((l) => <option key={l.id} value={l.name} />)}
      </datalist>
      <FieldStatus state={state} />
    </Field>
  );
}

/** Folders depth first, each with its path ("Acme › Clients") for an option group label. */
function flatFolders(nodes: FolderNode[], prefix = ""): { label: string; node: FolderNode }[] {
  return nodes.flatMap((n) => {
    const label = prefix ? `${prefix} › ${n.folder.name}` : n.folder.name;
    return [{ label, node: n }, ...flatFolders(n.folders, label)];
  });
}

/**
 * The task's list, chosen from live lists in sidebar order (the Inbox first), grouped by folder. Moving to another
 * list takes the subtasks along and puts the task at the top level there, as the server does.
 */
export function ListField({ task }: { task: Task }) {
  const id = useId();
  const lists = useLists().data ?? [];
  const folders = useFolders().data ?? [];
  const move = useMoveTask();
  const save = useSave();
  const [moving, setMoving] = useState<string | null>(null);
  const latestMove = useRef(0);
  const inbox = findInbox(lists);
  const tree = sidebarTree(folders, lists.filter((l) => l.id !== inbox?.id), "all");
  const top = [...(inbox ? [inbox] : []), ...tree.lists];
  const groups = flatFolders(tree.folders).filter((g) => g.node.lists.length > 0);
  const live = new Set([...top, ...groups.flatMap((g) => g.node.lists)].map((l) => l.id));
  // An archived (or not yet loaded) list still needs an option to show as chosen.
  const current = live.has(task.listId) ? null : lists.find((l) => l.id === task.listId);
  const onChange = (listId: string) => {
    if (listId === task.listId) return;
    const mine = ++latestMove.current;
    setMoving(listId);
    // Only the latest move settling shows the task's list again, so an earlier one doesn't flash its list.
    void save.run(move.mutateAsync({ id: task.id, listId })).finally(() => { if (mine === latestMove.current) setMoving(null); });
  };
  return (
    <Field label="List" htmlFor={id}>
      <select id={id} className="detail-select" value={moving ?? task.listId} onChange={(e) => onChange(e.target.value)}>
        {!live.has(task.listId) && <option value={task.listId}>{current?.name ?? "…"}</option>}
        {top.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        {groups.map((g) => (
          <optgroup key={g.node.folder.id} label={g.label}>
            {g.node.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
        ))}
      </select>
      <FieldStatus state={save.state} />
    </Field>
  );
}

/**
 * How the task repeats: a preset, or a custom RRULE typed in, and whether the next one counts from the due date or
 * from completion. The rule and its anchor are always sent together.
 */
export function RepeatField({ task }: { task: Task }) {
  const id = useId();
  const radios = useId();
  const { state, patch } = usePatch(task);
  const preset = presetFor(task.recurRule);
  const [custom, setCustom] = useState(preset === "custom");
  const [rule, setRule] = useState<string | null>(null);
  const ruleInput = useRef<HTMLInputElement>(null);
  const shown: Preset = custom || preset === "custom" ? "custom" : preset;
  const from = task.recurFrom ?? "due";

  // Choosing Custom… puts the cursor in the rule field.
  const focusRule = useRef(false);
  useEffect(() => {
    if (custom && focusRule.current) ruleInput.current?.focus();
    focusRule.current = false;
  }, [custom]);

  const choose = (next: Preset) => {
    if (next === "custom") {
      focusRule.current = true;
      setCustom(true);
      return;
    }
    setCustom(false);
    setRule(null);
    const recurRule = ruleFor(next);
    if (recurRule === task.recurRule) return;
    void patch(recurRule === null ? { recurRule: null, recurFrom: null } : { recurRule, recurFrom: from });
  };
  const saveRule = () => {
    if (rule === null) return;
    const recurRule = rule.trim();
    if (recurRule && recurRule !== task.recurRule) void patch({ recurRule, recurFrom: from });
    else setRule(null);
  };

  return (
    <Field label="Repeat" htmlFor={id}>
      <div className="detail-stack">
        <select id={id} className="detail-select" value={shown} onChange={(e) => choose(e.target.value as Preset)}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {shown === "custom" && (
          <input
            ref={ruleInput}
            type="text"
            className="detail-inline-input detail-rule"
            aria-label="Repeat rule"
            placeholder="FREQ=WEEKLY;BYDAY=SA"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={rule ?? task.recurRule ?? ""}
            onChange={(e) => setRule(e.target.value)}
            onKeyDown={(e) => {
              if (enterPressed(e)) {
                e.preventDefault();
                saveRule();
              }
            }}
            onBlur={saveRule}
          />
        )}
        {task.recurRule && (
          <div className="detail-radios" role="radiogroup" aria-label="Repeat from">
            {(["due", "completion"] as const).map((value) => (
              <label key={value} className="detail-radio">
                <input
                  type="radio"
                  name={radios}
                  value={value}
                  checked={from === value}
                  onChange={() => void patch({ recurRule: task.recurRule, recurFrom: value })}
                />
                {value === "due" ? "From due date" : "From completion"}
              </label>
            ))}
          </div>
        )}
        <FieldStatus state={state} />
      </div>
    </Field>
  );
}
