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
  SearchResultSchema,
} from "@claudia/shared";
import { folders, filters } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { notFound } from "../lib/errors";
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
import { runFilter, savedQuery } from "../domain/filters";

const tag = ["Filters"];
type Row = typeof filters.$inferSelect;

const toFilter = (r: Row) => ({
  id: r.id,
  name: r.name,
  query: r.query,
  sort: r.sort,
  group: r.groupBy,
  display: r.display,
  folderId: r.folderId,
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

const inFolder = (folderId: string | null) => (folderId === null ? isNull(filters.folderId) : eq(filters.folderId, folderId));

async function assertFolder(db: Db, id: string | null) {
  if (!id) return;
  const [row] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, id), isNull(folders.deletedAt)));
  if (!row) throw notFound("Folder");
}

const QUERY_HELP = "`query` is in the search language (see GET /api/search). A top-level sort: or group: in it moves into `sort` or `group`, unless those are given.";

export const filterRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/filters",
      tags: tag,
      summary: "List saved filters (smart views)",
      description: "In position order within each folder (`folderId`, null for none).",
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
      description: QUERY_HELP,
      request: { body: jsonBody(FilterCreateSchema) },
      responses: { 201: jsonResponse(FilterSchema, "Created"), 422: jsonResponse(ErrorSchema, "Invalid query"), ...commonErrors },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const folderId = input.folderId ?? null;
      await assertFolder(db, folderId);
      const at = now();
      const row: Row = {
        id: newId(),
        name: input.name,
        ...(await savedQuery(db, input)),
        display: input.display ?? {},
        folderId,
        position: await positionFor(db, filters, and(live, inFolder(folderId))),
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
      description: "Its tasks, sorted, with the sort and grouping in effect, as GET /api/search returns them.",
      request: { params: IdParam, query: FilterRunQuerySchema },
      responses: { 200: jsonResponse(SearchResultSchema, "Matching tasks"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const filter = await getFilter(c.var.db, c.req.valid("param").id);
      return c.json(await runFilter(c.var.db, filter, c.req.valid("query")), 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/filters/{id}",
      tags: tag,
      summary: "Rename a filter or change its query, sort, grouping or display",
      description: QUERY_HELP,
      request: { params: IdParam, body: jsonBody(FilterUpdateSchema) },
      responses: { 200: jsonResponse(FilterSchema, "Updated"), 422: jsonResponse(ErrorSchema, "Invalid query"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const before = await getFilter(db, id);
      const after: Row = { ...before, name: input.name ?? before.name, ...(await savedQuery(db, input, before)), display: input.display ?? before.display, updatedAt: now() };
      await runBatch(db, [
        db.update(filters)
          .set({ name: after.name, query: after.query, sort: after.sort, groupBy: after.groupBy, display: after.display, updatedAt: after.updatedAt })
          .where(eq(filters.id, id)),
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
      summary: "Move a filter to another folder (folderId, null for none) and/or reorder it among its siblings",
      request: { params: IdParam, body: jsonBody(FilterMoveSchema) },
      responses: { 200: jsonResponse(FilterSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const input = c.req.valid("json");
      const before = await getFilter(db, id);
      const folderId = input.folderId === undefined ? before.folderId : input.folderId;
      await assertFolder(db, folderId);
      const after: Row = { ...before, folderId, position: await positionFor(db, filters, and(live, inFolder(folderId)), input), updatedAt: now() };
      await runBatch(db, [
        db.update(filters).set({ folderId, position: after.position, updatedAt: after.updatedAt }).where(eq(filters.id, id)),
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
