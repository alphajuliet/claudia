import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import type { Task } from "@claudia/shared";

/** The task the panel last switched to by following the keyboard highlight: that panel leaves focus on the row. */
let followedId: string | null = null;

/**
 * Whether the panel for `id` was opened by following the highlight (it shouldn't take focus). The answer holds for
 * the rest of this task (so StrictMode's second effect run agrees) and is then forgotten, so going Back to the task
 * later opens the panel as usual.
 */
export function wasFollowed(id: string): boolean {
  if (followedId !== id) return false;
  queueMicrotask(() => {
    if (followedId === id) followedId = null;
  });
  return true;
}

/** The task just made with `n t` or `n s`, whose panel is open for filling in. */
let madeTask: Task | null = null;

export const markMade = (task: Task) => { madeTask = task; };
/** Whether `id` is that task: its panel starts on the title. */
export const isMade = (id: string) => madeTask?.id === id;
/** The task if it's `id`, and forgets it: its panel has closed. */
export function takeMade(id: string): Task | null {
  if (madeTask?.id !== id) return null;
  const task = madeTask;
  madeTask = null;
  return task;
}

/**
 * The selected task lives in the address as `?task=<id>`, on whatever path is showing, so reload and back keep it.
 * `select(null)` removes it. With `follow` (the panel following the keyboard highlight), the address is replaced
 * rather than added to, so Back doesn't step through every task passed.
 */
export function useSelectedTask(): { selectedId: string | null; select: (id: string | null, opts?: { follow?: boolean }) => void } {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const selectedId = params.get("task");
  const select = (id: string | null, opts: { follow?: boolean } = {}) => {
    if (id === selectedId) return;
    const next = new URLSearchParams(search);
    if (id) next.set("task", id);
    else next.delete("task");
    const query = next.toString();
    followedId = opts.follow ? id : null;
    navigate(query ? `${path}?${query}` : path, { replace: Boolean(opts.follow) });
  };
  return { selectedId, select };
}

/** A field to edit as soon as `id`'s panel shows it: `e n`, `e l` or `e m` pressed while the panel was closed. */
export type PendingField = "notes" | "labels" | "list";
let pendingEdit: { id: string; field: PendingField } | null = null;

/** Opens `id`'s panel on `field`: call before selecting the task. */
export const requestEdit = (id: string, field: PendingField) => { pendingEdit = { id, field }; };

/** True once if `field` of `id` was asked for, and forgets it. */
export function takeEdit(id: string, field: PendingField): boolean {
  if (pendingEdit?.id !== id || pendingEdit.field !== field) return false;
  pendingEdit = null;
  return true;
}

/**
 * Runs `start` when the field appears, if its edit was asked for before the panel opened. It runs just after the
 * panel's effects (which would otherwise take focus), and outside them, so `start` may flush a render of its own.
 */
export function usePendingEdit(id: string, field: PendingField, start: () => void) {
  const latest = useRef(start);
  latest.current = start;
  useEffect(() => {
    if (pendingEdit?.id !== id || pendingEdit.field !== field) return;
    // Taken only when it runs, so StrictMode's throwaway first mount leaves it for the real one.
    let live = true;
    queueMicrotask(() => { if (live && takeEdit(id, field)) latest.current(); });
    return () => { live = false; };
  }, [id]);
}
