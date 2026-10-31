import type { Counts, List } from "@claudia/shared";

export const VIEWS = [
  { id: "inbox", name: "Inbox" },
  { id: "today", name: "Today" },
  { id: "next", name: "Next" },
  { id: "wip", name: "WIP" },
  { id: "waiting", name: "Waiting" },
  { id: "someday", name: "Someday" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];

const LABELS: Partial<Record<ViewId, string>> = { next: "next", wip: "wip", waiting: "waitingOn", someday: "someday" };

/** The label a built-in view shows (and quick add gives), if any. */
export const viewLabel = (id: ViewId): string | undefined => LABELS[id];

export const findInbox = (lists: List[]) => lists.find((l) => l.archivedAt === null && l.name.toLowerCase() === "inbox");

/**
 * A built-in view's count of open tasks, from the per-list counts, over the lists it shows (`lists`: the Inbox and
 * the context's lists, or "all"). Inbox counts its own list.
 */
export function viewCount(id: ViewId, counts: Counts, lists: string[] | "all", inboxId: string | undefined): number {
  const shown = id === "inbox" ? (inboxId ? [inboxId] : []) : lists === "all" ? Object.keys(counts.lists) : lists;
  let n = 0;
  for (const listId of shown) {
    const c = counts.lists[listId];
    if (!c) continue;
    if (id === "inbox") n += c.open;
    else if (id === "today") n += c.today;
    else n += c.labels[LABELS[id]!.toLowerCase()] ?? 0;
  }
  return n;
}

/** The `GET /api/tasks` query string for a built-in view, or null when it can't be built (no Inbox list). */
export function viewQuery(id: ViewId, ctx: { today: string; inboxId: string | undefined }): string | null {
  const q = new URLSearchParams({ status: "open", limit: "500" });
  if (id === "inbox") {
    if (!ctx.inboxId) return null;
    q.set("listId", ctx.inboxId);
  } else if (id === "today") q.set("dueBefore", ctx.today);
  else q.set("label", LABELS[id]!);
  return q.toString();
}
