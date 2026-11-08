import { createRoute, z } from "@hono/zod-openapi";
import {
  IdParam,
  TaskCompletionSchema,
  TaskCreateSchema,
  TaskMoveSchema,
  TaskQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@claudia/shared";
import { createTask, deleteTask, findTasks, getTask, moveTask, setCompleted, updateTask } from "../domain/tasks";
import { commonErrors, jsonBody, jsonResponse, newRouter, notFoundError } from "../lib/router";

const tag = ["Tasks"];

/** The HTTP face of the task rules in `domain/tasks.ts`. */
export const taskRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/tasks",
      tags: tag,
      summary: "Query tasks",
      description: "Open tasks by default, in list order. Combine filters to build smart lists.",
      request: { query: TaskQuerySchema },
      responses: { 200: jsonResponse(z.array(TaskSchema), "Tasks"), ...commonErrors },
    }),
    async (c) => {
      return c.json(await findTasks(c.var.db, c.req.valid("query")), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks",
      tags: tag,
      summary: "Create a task or heading",
      request: { body: jsonBody(TaskCreateSchema) },
      responses: { 201: jsonResponse(TaskSchema, "Created"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(await createTask(c.var.db, c.var.actor, c.req.valid("json")), 201),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Get a task",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskSchema, "Task"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(await getTask(c.var.db, c.req.valid("param").id), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Update a task's fields or labels",
      description: "Only the fields you send change. Send null to clear a nullable field.",
      request: { params: IdParam, body: jsonBody(TaskUpdateSchema) },
      responses: { 200: jsonResponse(TaskSchema, "Updated"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(await updateTask(c.var.db, c.var.actor, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/move",
      tags: tag,
      summary: "Move a task to another list or parent, and/or reorder it",
      description: "Nested tasks move with their parent. Omit listId and parentId to reorder in place.",
      request: { params: IdParam, body: jsonBody(TaskMoveSchema) },
      responses: { 200: jsonResponse(TaskSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(await moveTask(c.var.db, c.var.actor, c.req.valid("param").id, c.req.valid("json")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/complete",
      tags: tag,
      summary: "Complete a task",
      description:
        "Completing a task that repeats advances it to its next due date and keeps it open, leaving its subtasks alone; completing it twice advances it twice. Other tasks: idempotent, and their open subtasks at every level are completed with them.",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskCompletionSchema, "Completed"), ...commonErrors, ...notFoundError },
    }),
    (c) => setCompleted(c.var.db, c.var.actor, c.req.valid("param").id, true).then((t) => c.json(t, 200)),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/uncomplete",
      tags: tag,
      summary: "Reopen a completed task",
      description: "Subtasks completed with it (at the same time) are reopened too; ones completed separately stay completed.",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskCompletionSchema, "Reopened"), ...commonErrors, ...notFoundError },
    }),
    (c) => setCompleted(c.var.db, c.var.actor, c.req.valid("param").id, false).then((t) => c.json(t, 200)),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Delete a task and anything nested under it (soft)",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      await deleteTask(c.var.db, c.var.actor, c.req.valid("param").id);
      return c.body(null, 204);
    },
  );
