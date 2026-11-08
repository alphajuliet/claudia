import { createRoute, z } from "@hono/zod-openapi";
import { ContextFilterSchema, TaskSchema, ViewIdParam, ViewSummarySchema, ViewTasksQuerySchema } from "@claudia/shared";
import { viewSummaries, viewTasks } from "../domain/views";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

const tag = ["Views"];
const RULES =
  "Every view shows open, unsnoozed tasks (not headings; subtasks included) in the context's lists: lists in no folder and the Inbox show in every context. " +
  "Inbox: the Inbox list. Today: due (by date, or by due time on that day) or started today or earlier. Next, WIP, Waiting, Someday: tasks with the label next, wip, waitingOn or someday.";

export const viewRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/views",
      tags: tag,
      summary: "The built-in views, with how many tasks each shows",
      description: RULES,
      request: { query: z.object({ context: ContextFilterSchema }) },
      responses: { 200: jsonResponse(z.array(ViewSummarySchema), "Views"), ...commonErrors },
    }),
    async (c) => c.json(await viewSummaries(c.var.db, c.req.valid("query").context), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/views/{id}/tasks",
      tags: tag,
      summary: "A built-in view's tasks",
      description: `${RULES} With status=completed: the view's completed tasks instead (for Today, those completed today). 422 no_inbox for Inbox when no list is the Inbox.`,
      request: { params: ViewIdParam, query: ViewTasksQuerySchema },
      responses: { 200: jsonResponse(z.array(TaskSchema), "Tasks, in list order"), ...commonErrors },
    }),
    async (c) => c.json(await viewTasks(c.var.db, c.req.valid("param").id, c.req.valid("query")), 200),
  );
