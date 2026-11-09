import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useCreateTask, useTimeZone } from "../data/queries";
import { formatWhen, nowIn, todayIn, zonedToUtc, type When } from "../lib/dates";
import { parseQuickAdd } from "../lib/quickAdd";
import { parseWhen } from "../lib/when";
import { useCommand } from "./keyboard";
import { useToast } from "./Toast";

/** Where quick add puts a task: a list, with labels the screen implies, and due today (the day it's added) if set. */
export interface QuickAddTarget { listId: string; listName: string; labels?: string[]; dueToday?: boolean }

interface Entry { text: string; dismissed: string | null }
const EMPTY: Entry = { text: "", dismissed: null };

/** The date at the end of the entry's title as of `at`, unless its words were kept in the title. */
function readWhen({ text, dismissed }: Entry, at: Date, timeZone: string) {
  const found = parseWhen(parseQuickAdd(text).title, at, timeZone);
  return found && found.matched !== dismissed ? found : null;
}

/** Today's date and time for `formatWhen`, from one instant. */
const today = (at: Date, timeZone: string): [string, string] => {
  const now = nowIn(timeZone, at);
  return [now.date, now.time];
};

/** The one due field a create body takes for a When: `dueAt` with a time, else `dueDate`. */
const createDue = (when: When, timeZone: string): { dueDate: string } | { dueAt: string } =>
  when.time ? { dueAt: zonedToUtc(when.date, when.time, timeZone) } : { dueDate: when.date };

/** Labels in order, without repeats ignoring case (the first spelling wins). */
const mergeLabels = (labels: string[]) =>
  labels.filter((l, i) => labels.findIndex((m) => m.toLowerCase() === l.toLowerCase()) === i);

/**
 * A one-line field above the rows. Enter adds the task (with any `#labels`, and a due date or time read from the end
 * of the text), clears the field and keeps focus; Escape clears and leaves. On a touch screen, leaving the field with
 * text in it adds the task too: the ✓ over the iOS keyboard only hides it, sending no Enter. A chip under the field previews the date,
 * and its × keeps those words in the title. When `announce` is set (the task goes somewhere other than the list on
 * screen), or a date was read, a toast says where it went. Nothing is shown without a target.
 */
export function QuickAdd({ target, announce = false }: { target: QuickAddTarget | undefined; announce?: boolean }) {
  // The text, and the date words the user chose to keep in its title (for as long as they are still the match).
  const [entry, setEntry] = useState<Entry>(EMPTY);
  const create = useCreateTask();
  const toast = useToast();
  const timeZone = useTimeZone();
  const input = useRef<HTMLInputElement>(null);
  const previewId = useId();
  // Escape leaves the field after clearing it: that blur mustn't add what was there.
  const cancelling = useRef(false);
  useCommand("capture", target ? () => input.current?.focus() : undefined);
  if (!target) return null;

  const { text, dismissed } = entry;
  const parsed = parseQuickAdd(text);
  const shown = readWhen(entry, new Date(), timeZone);
  const preview = shown && formatWhen(shown.when, ...today(new Date(), timeZone));

  const onChange = (next: string) =>
    setEntry((e) => ({
      text: next,
      dismissed: e.dismissed !== null && parseWhen(parseQuickAdd(next).title, new Date(), timeZone)?.matched === e.dismissed ? e.dismissed : null,
    }));

  const submit = () => {
    const sent = entry;
    if (!text.trim()) return;
    // Read again: the day may have changed since the last keystroke.
    const at = new Date();
    const when = readWhen(entry, at, timeZone);
    const labels = mergeLabels([...(target.labels ?? []), ...parsed.labels]);
    const due = when ? createDue(when.when, timeZone) : target.dueToday ? { dueDate: todayIn(timeZone, at) } : {};
    const dueText = when && formatWhen(when.when, ...today(at, timeZone)).text;
    setEntry(EMPTY);
    // mutateAsync, not mutate: each call's outcome is reported, even when several are running.
    create
      .mutateAsync({
        listId: target.listId,
        title: when ? when.title : parsed.title,
        // New tasks go first, next to the field they were typed in.
        atStart: true,
        ...(labels.length ? { labels } : {}),
        ...due,
      })
      .then(
        () => {
          // A dated task may leave the screen (a future date on Today), so say so even when it went to this list.
          const where = announce ? `Added to ${target.listName}` : "Added";
          if (dueText) toast.show({ message: `${where}, due ${dueText}` });
          else if (announce) toast.show({ message: where });
        },
        (e: Error) => {
          // Put the text (and any kept words) back unless something new has been typed since.
          setEntry((now) => (now.text ? now : sent));
          toast.show({ message: e.message, error: true });
        },
      );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setEntry(EMPTY);
      cancelling.current = true;
      e.currentTarget.blur();
    }
  };
  const onBlur = () => {
    if (cancelling.current) {
      cancelling.current = false;
      return;
    }
    if (touchScreen()) submit();
  };

  return (
    <div className="quick-add-wrap">
      <div className="quick-add">
        <span className="quick-add-plus" aria-hidden="true">+</span>
        <input
          ref={input}
          type="text"
          className="quick-add-input"
          aria-label="Add a task"
          aria-describedby={shown ? previewId : undefined}
          placeholder="Add a task"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </div>
      {shown && preview && (
        <div className={preview.overdue ? "quick-add-when overdue" : "quick-add-when"}>
          <span id={previewId}>
            Due {preview.text}
            {preview.overdue && <span className="sr-only"> (overdue)</span>}
          </span>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Keep “${shown.matched}” in the title`}
            // Keep focus in the field, so the tap doesn't count as leaving it (and add the task on a touch screen).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEntry((e) => ({ ...e, dismissed: shown.matched }));
              input.current?.focus();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** A touch screen (phone or iPad) as the main pointer. */
const touchScreen = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;
