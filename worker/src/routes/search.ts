import { createRoute } from "@hono/zod-openapi";
import { ErrorSchema, SearchQuerySchema, SearchResultSchema } from "@claudia/shared";
import { searchTasks } from "../domain/search";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

const DESCRIPTION =
  "Tasks matching a query in the search language (Lucene-style, parsed by liqe). " +
  "Words and \"phrases\" match title or notes. Fields: label: (or #name), list:, folder: (with subfolders), context:, priority: (low < normal < high), " +
  "due:, start:, snoozed:, completed:, created:, updated: (today, tomorrow, yesterday, 7d, 2w, 3m, today-7d or YYYY-MM-DD; with :<, :<=, :>, :>= or [\"today\" TO \"7d\"]), " +
  "is: (open, completed, snoozed, available, recurring, heading, subtask) and has: (due, start, notes, labels, parent). " +
  "Combine with AND, OR, NOT, -term and parentheses; a space means AND. Names ignore case and a leading emoji, and take * wildcards. " +
  "Unless the query says otherwise: open, unsnoozed tasks, not headings, in the context's lists (unless it names context: or folder:). " +
  "sort: and group: at the top level set the sort and grouping. 422 invalid_query with the column of the problem.";

export const searchRoutes = newRouter().openapi(
  createRoute({
    method: "get",
    path: "/api/search",
    tags: ["Search"],
    summary: "Search tasks with the query language",
    description: DESCRIPTION,
    request: { query: SearchQuerySchema },
    responses: {
      200: jsonResponse(SearchResultSchema, "Tasks in the sort, with the sort and grouping in effect"),
      422: jsonResponse(ErrorSchema, "The query has a problem (issues[0].column says where)"),
      ...commonErrors,
    },
  }),
  async (c) => c.json(await searchTasks(c.var.db, c.req.valid("query")), 200),
);
