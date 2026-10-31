import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  ErrorSchema,
  FilterCreateSchema,
  FilterMoveSchema,
  FilterRunQuerySchema,
  FilterSchema,
  FilterUpdateSchema,
  IdParam,
  TaskQuerySchema,
  TaskSchema,
} from "@claudia/shared";
import { filters } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { newId, now } from "../lib/ids";
import { positionFor } from "../lib/position";
import {
  commonErrors,
  jsonBody,
  jsonResponse,
  newRouter,
  notFoundError,
} from "../lib/router";
import { findTasks } from "./tasks";

const tag = ["Filters"];
type Row = typeof filters.$inferSelect;

const toFilter = (r: Row) => ({
  id: r.id,
  name: r.name,
  query: r.query,
  position: r.position,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const live = isNull(filters.deletedAt);

async function getFilter(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(filters).where(and(eq(filters.id, id), live));
  if (!row) throw notFound("Filter");
  return row;
}

/** Parse a stored query string with the same rules as GET /api/tasks. */
function parseQuery(query: string) {
  const params = Object.fromEntries(new URLSearchParams(query));
  const result = TaskQuerySchema.safeParse(params);
  if (!result.success) {
    throw new ApiError(422, "invalid_query", "The query isn't a valid task query", result.error.issues);
  }
  return result.data;
}

export const filterRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/filters",
      tags: tag,
      summary: "List saved filters in display order",
      responses: { 200: jsonResponse(z.array(FilterSchema), "Filters"), ...commonErrors },
    }),
    async (c) => {
      const rows = await c.var.db.select().from(filters).where(live).orderBy(asc(filters.position));
      return c.json(rows.map(toFilter), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/filters",
      tags: tag,
      summary: "Save a filter",
      description: "`query` takes the same parameters as GET /api/tasks, as a query string.",
      request: { body: jsonBody(FilterCreateSchema) },
      responses: { 201: jsonResponse(FilterSchema, "Created"), 422: jsonResponse(ErrorSchema, "Invalid query"), ...commonErrors },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      parseQuery(input.query);
      const at = now();
      const row: Row = {
        id: newId(),
        name: input.name,
        query: input.query,
        position: await positionFor(db, filters, live),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      await runBatch(db, [
        db.insert(filters).values(row),
        eventQuery(db, { entityType: "filter", entityId: row.id, type: "created", after: toFilter(row), actor: c.var.actor }),
      ]);
      return c.json(toFilter(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/filters/{id}",
      tags: tag,
      summary: "Get a saved filter",
      request: { params: IdParam },
      responses: { 200: jsonResponse(FilterSchema, "Filter"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(toFilter(await getFilter(c.var.db, c.req.valid("param").id)), 200),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/filters/{id}/tasks",
      tags: tag,
      summary: "Run a saved filter",
      request: { params: IdParam, query: FilterRunQuerySchema },
      responses: { 200: jsonResponse(z.array(TaskSchema), "Matching tasks"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { status, limit, offset } = c.req.valid("query");
      const filter = await getFilter(c.var.db, c.req.valid("param").id);
      const q = parseQuery(filter.query);
      return c.json(await findTasks(c.var.db, { ...q, status: status ?? q.status, limit: limit ?? q.limit, offset: offset ?? q.offset }), 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/filters/{id}",
      tags: tag,
      summary: "Rename a filter or change its query",
      request: { params: IdParam, body: jsonBody(FilterUpdateSchema) },
      responses: { 200: jsonResponse(FilterSchema, "Updated"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name, query } = c.req.valid("json");
      const db = c.var.db;
      const before = await getFilter(db, id);
      if (query !== undefined) parseQuery(query);
      const after: Row = { ...before, name: name ?? before.name, query: query ?? before.query, updatedAt: now() };
      await runBatch(db, [
        db.update(filters).set({ name: after.name, query: after.query, updatedAt: after.updatedAt }).where(eq(filters.id, id)),
        eventQuery(db, { entityType: "filter", entityId: id, type: "updated", before: toFilter(before), after: toFilter(after), actor: c.var.actor }),
      ]);
      return c.json(toFilter(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/filters/{id}/move",
      tags: tag,
      summary: "Reorder a filter",
      request: { params: IdParam, body: jsonBody(FilterMoveSchema) },
      responses: { 200: jsonResponse(FilterSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const before = await getFilter(db, id);
      const after: Row = { ...before, position: await positionFor(db, filters, live, c.req.valid("json")), updatedAt: now() };
      await runBatch(db, [
        db.update(filters).set({ position: after.position, updatedAt: after.updatedAt }).where(eq(filters.id, id)),
        eventQuery(db, { entityType: "filter", entityId: id, type: "moved", before: toFilter(before), after: toFilter(after), actor: c.var.actor }),
      ]);
      return c.json(toFilter(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/filters/{id}",
      tags: tag,
      summary: "Delete a saved filter (soft)",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const before = await getFilter(db, id);
      const at = now();
      await runBatch(db, [
        db.update(filters).set({ deletedAt: at, updatedAt: at }).where(eq(filters.id, id)),
        eventQuery(db, { entityType: "filter", entityId: id, type: "deleted", before: toFilter(before), actor: c.var.actor }),
      ]);
      return c.body(null, 204);
    },
  );
