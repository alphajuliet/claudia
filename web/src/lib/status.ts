import type { Label, Task } from "@claudia/shared";

/**
 * Status labels (next, wip, waitingOn, ...): a task has one at most. Which labels are status labels, and their order,
 * come from the Labels screen (`status`, `statusPosition`).
 */

/** The status labels, in their order. */
export function statusLabels(labels: Label[]): Label[] {
  return labels.filter((l) => l.status).sort((a, b) => (a.statusPosition! < b.statusPosition! ? -1 : a.statusPosition! > b.statusPosition! ? 1 : 0));
}

const has = (names: string[], name: string) => names.some((n) => n.toLowerCase() === name.toLowerCase());

/** The task's status label (as the task names it), or null. With more than one, the first in order. */
export function statusOf(task: Pick<Task, "labels">, status: Label[]): string | null {
  const first = status.find((s) => has(task.labels, s.name));
  return first ? task.labels.find((n) => n.toLowerCase() === first.name.toLowerCase())! : null;
}

/** Whether `name` is a status label. */
export const isStatus = (name: string, status: Label[]) => status.some((s) => s.name.toLowerCase() === name.toLowerCase());

/** A task's labels with its status set to `name` (null for none): other status labels come off, the rest stay. */
export function withStatus(labels: string[], name: string | null, status: Label[]): string[] {
  const rest = labels.filter((n) => !isStatus(n, status));
  return name ? [...rest, name] : rest;
}
