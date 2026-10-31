import { useEffect, useRef, useState } from "react";
import type { Task } from "@claudia/shared";
import { formatWhen, splitIn, todayIn, type When } from "../lib/dates";
import { dueFields, quickDates } from "../lib/when";
import { Field, FieldStatus, usePatch, type SaveState } from "./TaskFields";

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
function IdleInput({ type, label, value, complete, disabled = false, onSave }: {
  type: "date" | "time";
  label: string;
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
      value={draft ?? value ?? ""}
      onChange={(e) => {
        const typed = e.target.value;
        setDraft(typed);
        if (complete(typed)) later(typed);
        else cancel();
      }}
      onBlur={() => {
        cancel();
        // A browser's date and time fields report a whole value or "".
        if (draft !== null) save(draft);
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
              onClick={() => onSave({ date: c.date, time: c.time ?? value?.time ?? null })}
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
            onSave={(date) => onSave(date ? { date, time: value?.time ?? null } : null)}
          />
          <IdleInput
            type="time"
            label={`${label} time`}
            value={value?.time ?? null}
            complete={wholeTime}
            disabled={timeDisabled}
            onSave={(time) => onSave(time ? { date: value?.date ?? today, time } : value && { date: value.date, time: null })}
          />
        </div>
        {timeDisabled && <p className="when-note muted">Times on repeating tasks are coming</p>}
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

/** The start date, edited as before for now. */
function StartField({ task }: { task: Task }) {
  const { state, patch } = usePatch(task);
  return (
    <Field label="Start" group>
      <IdleInput type="date" label="Start date" value={task.startDate} complete={wholeDate} onSave={(startDate) => void patch({ startDate })} />
      {task.startDate && (
        <button type="button" className="quiet small" aria-label="Clear start date" onClick={() => void patch({ startDate: null })}>
          Clear
        </button>
      )}
      <FieldStatus state={state} />
    </Field>
  );
}

/** The task's dates. `onClose` is for Snooze, which closes the panel once the task leaves the view. */
export function DateFields({ task, timeZone }: { task: Task; timeZone: string; onClose: () => void }) {
  return (
    <>
      <DueField task={task} timeZone={timeZone} />
      <StartField task={task} />
    </>
  );
}
