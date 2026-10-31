import { useRef, useState, type KeyboardEvent } from "react";
import { useCreateTask, useTimeZone } from "../data/queries";
import { formatWhen, splitIn, todayIn, type When } from "../lib/dates";
import { parseQuickAdd } from "../lib/quickAdd";
import { dueFields, parseWhen } from "../lib/when";
import { useCommand } from "./keyboard";
import { useToast } from "./Toast";

/** Where quick add puts a task: a list, with labels the screen implies, and due today (the day it's added) if set. */
export interface QuickAddTarget { listId: string; listName: string; labels?: string[]; dueToday?: boolean }

/** Labels in order, without repeats ignoring case (the first spelling wins). */
const mergeLabels = (labels: string[]) =>
  labels.filter((l, i) => labels.findIndex((m) => m.toLowerCase() === l.toLowerCase()) === i);

/**
 * A one-line field above the rows. Enter adds the task (with any `#labels`, and a due date or time read from the end
 * of the text), clears the field and keeps focus; Escape clears and leaves. A chip under the field previews the date,
 * and its × keeps those words in the title. When `announce` is set (the task goes somewhere other than the list on
 * screen), or a date was read, a toast says where it went. Nothing is shown without a target.
 */
export function QuickAdd({ target, announce = false }: { target: QuickAddTarget | undefined; announce?: boolean }) {
  const [text, setText] = useState("");
  // The date words the user chose to keep in the title, for this entry only.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const create = useCreateTask();
  const toast = useToast();
  const timeZone = useTimeZone();
  const input = useRef<HTMLInputElement>(null);
  useCommand("capture", target ? () => input.current?.focus() : undefined);
  if (!target) return null;

  const parsed = parseQuickAdd(text);
  /** The date at the end of the title, unless its words were kept, read as of `at`. */
  const readWhen = (at: Date) => {
    const found = parseWhen(parsed.title, at, timeZone);
    return found && found.matched !== dismissed ? found : null;
  };
  /** "Tomorrow, 3:00 pm", as of `at`. */
  const describe = (when: When, at: Date) => formatWhen(when, todayIn(timeZone, at), splitIn(at.toISOString(), timeZone).time).text;
  const shown = readWhen(new Date());
  const clear = () => { setText(""); setDismissed(null); };

  const submit = () => {
    const sent = text;
    if (!sent.trim()) return;
    // Read again: the day may have changed since the last keystroke.
    const at = new Date();
    const when = readWhen(at);
    const labels = mergeLabels([...(target.labels ?? []), ...parsed.labels]);
    // Only the field that is set: the API takes no nulls on create.
    const due = when
      ? Object.fromEntries(Object.entries(dueFields(when.when, timeZone)).filter(([, v]) => v !== null))
      : target.dueToday ? { dueDate: todayIn(timeZone, at) } : {};
    const dueText = when && describe(when.when, at);
    clear();
    // mutateAsync, not mutate: each call's outcome is reported, even when several are running.
    create
      .mutateAsync({
        listId: target.listId,
        title: when ? when.title : parsed.title,
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
          // Put the text back unless something new has been typed since.
          setText((now) => (now ? now : sent));
          toast.show({ message: e.message, error: true });
        },
      );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      clear();
      e.currentTarget.blur();
    }
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
          placeholder="Add a task"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {shown && (
        <div className="quick-add-when">
          <span>Due {describe(shown.when, new Date())}</span>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Keep “${shown.matched}” in the title`}
            onClick={() => { setDismissed(shown.matched); input.current?.focus(); }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
