import { useEffect, useId, useRef, useState } from "react";
import type { Task } from "@claudia/shared";
import { useUpdateTask } from "../data/queries";
import { formatDue, formatWhen, splitIn, todayIn, zonedToUtc, type When } from "../lib/dates";
import { isSnoozed } from "../lib/tasks";
import { dueFields, quickDates } from "../lib/when";
import { Field, FieldStatus, usePatch, type SaveState } from "./TaskFields";
import { useToast } from "./Toast";

/*
 * The panel's date fields. Each is a WhenField: what is set now, quick choices, and native date and time inputs, so
 * iOS and iPad show their own pickers.
 */

const DATE = /^(\d{4})-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const DATE_IDLE_MS = 600;

/** A date whose year is all typed; a browser's date field shows 0002, 0020, 0202 on the way to 2026. */
const wholeDate = (date: string) => Number(DATE.exec(date)?.[1] ?? 0) >= 1900;
const wholeTime = (time: string) => TIME.test(time);

/**
 * A native date or time input. A complete value saves after a moment without changes, or on leaving the field, so
 * retyping a day sends one save. One still being typed (a year on its way to 2026) waits until leaving the field.
 */
function IdleInput({ type, label, value, complete, disabled = false, describedBy, onSave }: {
  type: "date" | "time";
  label: string;
  describedBy?: string;
  value: string | null;
  complete: (value: string) => boolean;
  disabled?: boolean;
  onSave: (value: string | null) => void;
}) {
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
  const save = (typed: string) => {
    const next = typed === "" ? null : typed;
    if (next !== value) onSave(next);
  };
  const later = (typed: string) => {
    cancel();
    pending.current = () => {
      save(typed);
      setDraft(null);
    };
    timer.current = setTimeout(flush, DATE_IDLE_MS);
  };
  // Closing the panel doesn't drop a value waiting to save.
  useEffect(() => flush, []);
  return (
    <input
      type={type}
      className="detail-date"
      aria-label={label}
      disabled={disabled}
      aria-describedby={describedBy}
      value={draft ?? value ?? ""}
      onChange={(e) => {
        const typed = e.target.value;
        setDraft(typed);
        if (complete(typed)) later(typed);
        else cancel();
      }}
      onBlur={() => {
        cancel();
        // Only a whole value or none: a year left at 0202 isn't saved.
        if (draft !== null && (draft === "" || complete(draft))) save(draft);
        setDraft(null);
      }}
    />
  );
}

/** A quick choice: a day, and a time that replaces the current one (otherwise the current time is kept). */
export interface WhenChoice { label: string; date: string; time?: string }

/**
 * A day with an optional time: what is set now (overdue in red when `showOverdue`) with Clear, quick choices, and date
 * and time inputs. A time needs a day, so a time typed with none set is today.
 */
export function WhenField({ label, name, value, choices, today, nowTime, timeDisabled = false, showOverdue = false, status, onSave }: {
  label: string;
  name: string;
  value: When | null;
  choices: WhenChoice[];
  today: string;
  nowTime: string;
  timeDisabled?: boolean;
  showOverdue?: boolean;
  status: SaveState;
  onSave: (when: When | null) => void;
}) {
  const shown = value && formatWhen(value, today, nowTime);
  const noteId = useId();
  // Without times, a new day drops the one already set (such as an imported due time on a repeating task).
  const keptTime = timeDisabled ? null : value?.time ?? null;
  return (
    <Field label={label} group>
      <div className="when">
        <div className="when-current">
          {shown ? (
            <span className={showOverdue && shown.overdue ? "due overdue" : undefined}>{shown.text}</span>
          ) : (
            <span className="muted">None</span>
          )}
          {value && (
            <button type="button" className="quiet small" aria-label={`Clear ${name}`} onClick={() => onSave(null)}>
              Clear
            </button>
          )}
          <FieldStatus state={status} />
        </div>
        <div className="when-choices">
          {choices.map((c) => (
            <button
              key={c.label}
              type="button"
              className="quiet small"
              aria-label={`${label}: ${c.label}`}
              onClick={() => onSave({ date: c.date, time: timeDisabled ? null : c.time ?? keptTime })}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="when-inputs">
          <IdleInput
            type="date"
            label={`${label} date`}
            value={value?.date ?? null}
            complete={wholeDate}
            onSave={(date) => onSave(date ? { date, time: keptTime } : null)}
          />
          <IdleInput
            type="time"
            label={`${label} time`}
            value={value?.time ?? null}
            complete={wholeTime}
            disabled={timeDisabled}
            describedBy={timeDisabled ? noteId : undefined}
            onSave={(time) => onSave(time ? { date: value?.date ?? today, time } : value && { date: value.date, time: null })}
          />
        </div>
        {timeDisabled && <p id={noteId} className="when-note muted">Times on repeating tasks are coming</p>}
      </div>
    </Field>
  );
}

/**
 * Due: a date alone or a date with a time, never both. Repeating tasks can't take a time yet: recurrence ignores
 * `dueAt`, so the next completion would be the last.
 */
function DueField({ task, timeZone }: { task: Task; timeZone: string }) {
  const { state, patch } = usePatch(task);
  const today = todayIn(timeZone);
  const nowTime = splitIn(new Date().toISOString(), timeZone).time;
  const quick = quickDates(today);
  const value: When | null = task.dueAt ? splitIn(task.dueAt, timeZone) : task.dueDate ? { date: task.dueDate, time: null } : null;
  return (
    <WhenField
      label="Due"
      name="due date"
      value={value}
      choices={[
        { label: "Today", date: quick.today },
        { label: "Tomorrow", date: quick.tomorrow },
        { label: "This weekend", date: quick.weekend },
        { label: "Next week", date: quick.nextWeek },
      ]}
      today={today}
      nowTime={nowTime}
      timeDisabled={Boolean(task.recurRule)}
      showOverdue
      status={state}
      onSave={(when) => void patch(dueFields(when, timeZone))}
    />
  );
}

/** The task's snooze as a When: one that has passed is none, and midnight is the day alone. */
function snoozeWhen(task: Task, timeZone: string): When | null {
  if (!isSnoozed(task)) return null;
  const { date, time } = splitIn(task.snoozedUntil!, timeZone);
  return { date, time: time === "00:00" ? null : time };
}

/**
 * Snooze: a day alone is the start of that day. Views hide snoozed tasks, so snoozing into the future closes the panel
 * at once, then the toast says until when, with Undo.
 */
function SnoozeField({ task, timeZone, onClose }: { task: Task; timeZone: string; onClose: () => void }) {
  const { state, patch } = usePatch(task);
  const update = useUpdateTask();
  const toast = useToast();
  const today = todayIn(timeZone);
  const nowTime = splitIn(new Date().toISOString(), timeZone).time;
  const quick = quickDates(today);
  const choices: WhenChoice[] = [
    ...(nowTime < "18:00" ? [{ label: "This evening", date: today, time: "18:00" }] : []),
    ...[
      { label: "Tomorrow", date: quick.tomorrow },
      { label: "This weekend", date: quick.weekend },
      { label: "Next week", date: quick.nextWeek },
    ].filter((c) => c.date !== today),
  ];
  const onSave = (when: When | null) => {
    const previous = task.snoozedUntil;
    const snoozedUntil = when ? zonedToUtc(when.date, when.time ?? "00:00", timeZone) : null;
    const away = snoozedUntil !== null && snoozedUntil > new Date().toISOString();
    if (away) onClose();
    void patch({ snoozedUntil }).then((saved) => {
      if (!saved || !away) return;
      toast.show({
        message: `Snoozed until ${formatWhen(when!, todayIn(timeZone), nowTime).text}`,
        action: {
          label: "Undo",
          run: () => {
            update.mutateAsync({ id: task.id, patch: { snoozedUntil: previous } }).catch((e: Error) => toast.show({ message: e.message, error: true }));
          },
        },
      });
    });
  };
  return (
    <WhenField
      label="Snooze"
      name="snooze"
      value={snoozeWhen(task, timeZone)}
      choices={choices}
      today={today}
      nowTime={nowTime}
      status={state}
      onSave={onSave}
    />
  );
}

/** A start date, shown only when one is set. Nothing uses it, so the panel can clear it but not set it. */
function StartField({ task, timeZone }: { task: Task; timeZone: string }) {
  const { state, patch } = usePatch(task);
  if (!task.startDate) return null;
  return (
    <Field label="Start" group>
      <div className="when-current">
        <span>{formatDue(task.startDate, todayIn(timeZone)).text}</span>
        <button type="button" className="quiet small" aria-label="Clear start date" onClick={() => void patch({ startDate: null })}>
          Clear
        </button>
        <FieldStatus state={state} />
      </div>
    </Field>
  );
}

/** The task's dates: Due, Snooze, then Start. `onClose` closes the panel when a snooze takes the task out of view. */
export function DateFields({ task, timeZone, onClose }: { task: Task; timeZone: string; onClose: () => void }) {
  return (
    <>
      <DueField task={task} timeZone={timeZone} />
      <SnoozeField task={task} timeZone={timeZone} onClose={onClose} />
      <StartField task={task} timeZone={timeZone} />
    </>
  );
}
