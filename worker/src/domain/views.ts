/**
 * The built-in views (Inbox, Today, Next, WIP, Waiting, Someday): what each shows, written once here for the web app,
 * MCP and the counts. A view shows open, unsnoozed tasks (not headings, subtasks included) in the context's lists.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { VIEWS, type ContextFilter, type ViewId } from "@claudia/shared";
import { folders, lists, tasks } from "../db/schema";
import type { Db } from "../lib/db";
import { ApiError } from "../lib/errors";
import { addDays, startOfDayIn, todayIn, userTimeZone } from "../lib/recurrence";
import { activeBy, fetchTasks, hasLabel, openTask } from "./tasks";

/** What a view needs to know about now: the day, the Inbox and the context's lists. */
export interface ViewScope {
  today: string;
  timeZone: string;
  /** An ISO timestamp: tasks snoozed past it are hidden. */
  now: string;
  inboxId: string | null;
  /** The lists the context covers, or null for every list. */
  listIds: string[] | null;
}

/**
 * The lists a context covers, as the sidebar shows them: lists in no folder, lists in the context's folders (a
 * folder of another context hides what's under it), and the Inbox. Archived lists are left out. Null for "all".
 */
export async function listsInContext(db: Db, context: ContextFilter, inboxId: string | null): Promise<string[] | null> {
  if (context === "all") return null;
  const [allFolders, allLists] = await Promise.all([
    db.select({ id: folders.id, parentId: folders.parentId, context: folders.context }).from(folders).where(isNull(folders.deletedAt)),
    db.select({ id: lists.id, folderId: lists.folderId }).from(lists).where(and(isNull(lists.deletedAt), isNull(lists.archivedAt))),
  ]);
  const shown = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const f of allFolders) {
      if (f.parentId === parentId && f.context === context) {
        shown.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(null);
  const ids = allLists.filter((l) => l.folderId === null || shown.has(l.folderId)).map((l) => l.id);
  return inboxId && !ids.includes(inboxId) ? [inboxId, ...ids] : ids;
}

export async function viewScope(db: Db, context: ContextFilter, at = new Date()): Promise<ViewScope> {
  const timeZone = await userTimeZone(db);
  const [inbox] = await db.select({ id: lists.id }).from(lists).where(and(isNull(lists.deletedAt), eq(lists.inbox, true))).limit(1);
  const inboxId = inbox?.id ?? null;
  return { today: todayIn(timeZone, at), timeZone, now: at.toISOString(), inboxId, listIds: await listsInContext(db, context, inboxId) };
}

/** What sets a view apart from the others; null when it can't show anything (Inbox with no Inbox list). */
function viewRule(id: ViewId, scope: ViewScope): SQL | undefined | null {
  if (id === "inbox") return scope.inboxId ? eq(tasks.listId, scope.inboxId) : null;
  if (id === "today") return activeBy(scope.today, scope.timeZone);
  const label = VIEWS.find((v) => v.id === id)!.label!;
  return hasLabel(label);
}

/** The context's lists, as a condition (none for "all"; nothing at all for an empty context). */
const inLists = (scope: ViewScope) =>
  scope.listIds === null ? undefined : scope.listIds.length ? inArray(tasks.listId, scope.listIds) : sql`0`;

/**
 * A view's tasks. Open: what it shows. Completed: its tasks that were completed (Today: completed today), for
 * "show completed".
 */
export function viewCondition(id: ViewId, scope: ViewScope, status: "open" | "completed"): SQL | undefined | null {
  const rule = viewRule(id, scope);
  if (rule === null) return null;
  if (status === "open") return and(openTask(scope.now), rule, inLists(scope));
  const today =
    id === "today"
      ? and(
          gte(tasks.completedAt, startOfDayIn(scope.today, scope.timeZone).toISOString()),
          lt(tasks.completedAt, startOfDayIn(addDays(scope.today, 1), scope.timeZone).toISOString()),
        )
      : undefined;
  return and(isNull(tasks.deletedAt), isNotNull(tasks.completedAt), eq(tasks.kind, "task"), rule, inLists(scope), today);
}

export async function viewTasks(db: Db, id: ViewId, q: { context: ContextFilter; status: "open" | "completed"; limit: number; offset: number }) {
  const where = viewCondition(id, await viewScope(db, q.context), q.status);
  if (where === null) throw new ApiError(422, "no_inbox", "There's no Inbox: make a list the Inbox first");
  return fetchTasks(db, where, q);
}

/** Every view with how many open tasks it shows in the context. Inbox shows 0 when there's no Inbox. */
export async function viewSummaries(db: Db, context: ContextFilter) {
  const scope = await viewScope(db, context);
  return Promise.all(
    VIEWS.map(async (v) => {
      const where = viewCondition(v.id, scope, "open");
      const [row] = where === null ? [{ n: 0 }] : await db.select({ n: sql<number>`count(*)` }).from(tasks).where(where);
      return { id: v.id, name: v.name, label: v.label, count: Number(row?.n ?? 0) };
    }),
  );
}

