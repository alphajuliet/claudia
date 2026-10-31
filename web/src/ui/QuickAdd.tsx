import { useRef, useState, type KeyboardEvent } from "react";
import { useCreateTask, useTimeZone } from "../data/queries";
import { todayIn } from "../lib/dates";
import { parseQuickAdd } from "../lib/quickAdd";
import { useCommand } from "./keyboard";
import { useToast } from "./Toast";

/** Where quick add puts a task: a list, with labels the screen implies, and due today (the day it's added) if set. */
export interface QuickAddTarget { listId: string; listName: string; labels?: string[]; dueToday?: boolean }

/** Labels in order, without repeats ignoring case (the first spelling wins). */
const mergeLabels = (labels: string[]) =>
  labels.filter((l, i) => labels.findIndex((m) => m.toLowerCase() === l.toLowerCase()) === i);

/**
 * A one-line field above the rows. Enter adds the task (with any `#labels`), clears the field and keeps focus;
 * Escape clears and leaves. When `announce` is set (the task goes somewhere other than the list on screen),
 * a toast says where it went. Nothing is shown without a target.
 */
export function QuickAdd({ target, announce = false }: { target: QuickAddTarget | undefined; announce?: boolean }) {
  const [text, setText] = useState("");
  const create = useCreateTask();
  const toast = useToast();
  const timeZone = useTimeZone();
  const input = useRef<HTMLInputElement>(null);
  useCommand("capture", target ? () => input.current?.focus() : undefined);
  if (!target) return null;

  const submit = () => {
    const sent = text;
    if (!sent.trim()) return;
    const parsed = parseQuickAdd(sent);
    const labels = mergeLabels([...(target.labels ?? []), ...parsed.labels]);
    setText("");
    // mutateAsync, not mutate: each call's outcome is reported, even when several are running.
    create
      .mutateAsync({
        listId: target.listId,
        title: parsed.title,
        ...(labels.length ? { labels } : {}),
        ...(target.dueToday ? { dueDate: todayIn(timeZone) } : {}),
      })
      .then(
        () => { if (announce) toast.show({ message: `Added to ${target.listName}` }); },
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
      setText("");
      e.currentTarget.blur();
    }
  };

  return (
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
  );
}
