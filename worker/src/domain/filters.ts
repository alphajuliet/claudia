/**
 * Saved filters: the smart views. A filter keeps a search-language query without its sort: and group:, which live in
 * their own columns, and runs through the same engine as GET /api/search.
 */
import type { ContextFilter } from "@claudia/shared";
import type { filters } from "../db/schema";
import type { Db } from "../lib/db";
import { checkSearch, searchTasks, splitQuery } from "./search";

type Row = typeof filters.$inferSelect;

/**
 * The query, sort and grouping to store for a create or update. A sort: or group: written in the query moves into
 * its column, unless the input gives that column itself (null clears it). A query that doesn't parse is a 422.
 */
export async function savedQuery(
  db: Db,
  input: { query?: string | undefined; sort?: string | null | undefined; group?: string | null | undefined },
  before: Pick<Row, "query" | "sort" | "groupBy"> = { query: "", sort: null, groupBy: null },
): Promise<Pick<Row, "query" | "sort" | "groupBy">> {
  const split = input.query === undefined ? null : splitQuery(input.query);
  if (split) await checkSearch(db, split.query);
  return {
    query: split ? split.query : before.query,
    sort: input.sort !== undefined ? input.sort : (split?.sort ?? before.sort),
    groupBy: input.group !== undefined ? input.group : (split?.group ?? before.groupBy),
  };
}

/** A filter's tasks, with the sort and grouping in effect. */
export function runFilter(
  db: Db,
  filter: Row,
  opts: { context: ContextFilter; status?: "open" | "completed" | "all" | undefined; limit: number; offset: number },
) {
  return searchTasks(db, {
    q: filter.query,
    sort: filter.sort ?? undefined,
    group: filter.groupBy ?? undefined,
    context: opts.context,
    ...(opts.status ? { status: opts.status } : {}),
    limit: opts.limit,
    offset: opts.offset,
  });
}
