import type { List } from "@claudia/shared";

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

export const findInbox = (lists: List[]) => lists.find((l) => l.archivedAt === null && l.name.toLowerCase() === "inbox");

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
