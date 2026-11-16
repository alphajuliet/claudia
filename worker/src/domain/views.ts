/**
 * The built-in views (Inbox, Today, Next, WIP, Waiting, Someday): each is a search query (`VIEWS` in shared), run
 * through the search engine for the web app, MCP and the counts, so a view and the same typed search can't disagree.
 */
import { asc, sql } from "drizzle-orm";
import { VIEWS, type ContextFilter, type ViewId } from "@claudia/shared";
import { tasks } from "../db/schema";
import type { Db } from "../lib/db";
import { ApiError } from "../lib/errors";
import { parseSearch, searchCondition, searchScope, type Scope } from "./search";
import { fetchTasks } from "./tasks";

/** A view's query, as typed in Search. With Show completed, Today shows only what was completed today. */
export function viewQuery(id: ViewId, status: "open" | "completed" = "open"): string {
  const { query } = VIEWS.find((v) => v.id === id)!;
  return status === "completed" && id === "today" ? `(${query}) AND completed:today` : query;
}

const viewCondition = (db: Db, id: ViewId, context: ContextFilter, status: "open" | "completed", scope: Scope) =>
  searchCondition(db, parseSearch(viewQuery(id, status)).ast, { context, status }, scope);

/** A view's tasks, in list order. Open: what it shows. Completed: its tasks that were completed, for Show completed. */
export async function viewTasks(db: Db, id: ViewId, q: { context: ContextFilter; status: "open" | "completed"; limit: number; offset: number }) {
  const scope = await searchScope(db);
  if (id === "inbox" && !scope.inboxId) throw new ApiError(422, "no_inbox", "There's no Inbox: make a list the Inbox first");
  return fetchTasks(db, await viewCondition(db, id, q.context, q.status, scope), q, [asc(tasks.listId), asc(tasks.position)]);
}

/** Every view with its query and how many open tasks it shows in the context. Inbox shows 0 when there's no Inbox. */
export async function viewSummaries(db: Db, context: ContextFilter) {
  const scope = await searchScope(db);
  return Promise.all(
    VIEWS.map(async (v) => {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(tasks).where(await viewCondition(db, v.id, context, "open", scope));
      return { id: v.id, name: v.name, label: v.label, query: v.query, count: Number(row?.n ?? 0) };
    }),
  );
}
