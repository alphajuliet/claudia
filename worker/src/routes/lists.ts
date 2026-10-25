import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  IdParam,
  ListCreateSchema,
  ListMoveSchema,
  ListSchema,
  ListUpdateSchema,
} from "@claudia/shared";
import { folders, lists, tasks } from "../db/schema";
import type { Db } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { newId, now } from "../lib/ids";
import { positionFor } from "../lib/position";
import {
  commonErrors,
  conflictError,
  jsonBody,
  jsonResponse,
  newRouter,
  notFoundError,
} from "../lib/router";

const tag = ["Lists"];
type Row = typeof lists.$inferSelect;

export const toList = (r: Row) => ({
  id: r.id,
  name: r.name,
  folderId: r.folderId,
  position: r.position,
  archivedAt: r.archivedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const live = isNull(lists.deletedAt);
const inFolder = (folderId: string | null) =>
  folderId === null ? isNull(lists.folderId) : eq(lists.folderId, folderId);

export async function getList(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(lists).where(and(eq(lists.id, id), live));
  if (!row) throw notFound("List");
  return row;
}

async function assertFolder(db: Db, id: string | null) {
  if (!id) return;
  const [row] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, id), isNull(folders.deletedAt)));
  if (!row) throw notFound("Folder");
}

export const listRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/lists",
      tags: tag,
      summary: "List lists in display order",
      request: {
        query: z.object({
          archived: z.enum(["true", "false"]).optional().openapi({ description: "Filter by archived state; omit for all" }),
        }),
      },
      responses: { 200: jsonResponse(z.array(ListSchema), "Lists"), ...commonErrors },
    }),
    async (c) => {
      const { archived } = c.req.valid("query");
      const state = archived === undefined ? undefined : archived === "true" ? isNotNull(lists.archivedAt) : isNull(lists.archivedAt);
      const rows = await c.var.db.select().from(lists).where(and(live, state)).orderBy(asc(lists.position));
      return c.json(rows.map(toList), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/lists",
      tags: tag,
      summary: "Create a list",
      request: { body: jsonBody(ListCreateSchema) },
      responses: { 201: jsonResponse(ListSchema, "Created"), ...commonErrors, ...notFoundError },
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
        folderId,
        position: await positionFor(db, lists, and(live, inFolder(folderId))),
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      await db.batch([
        db.insert(lists).values(row),
        eventQuery(db, { entityType: "list", entityId: row.id, type: "created", after: toList(row), actor: c.var.actor }),
      ]);
      return c.json(toList(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/lists/{id}",
      tags: tag,
      summary: "Get a list",
      request: { params: IdParam },
      responses: { 200: jsonResponse(ListSchema, "List"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(toList(await getList(c.var.db, c.req.valid("param").id)), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/lists/{id}",
      tags: tag,
      summary: "Rename, archive or unarchive a list",
      request: { params: IdParam, body: jsonBody(ListUpdateSchema) },
      responses: { 200: jsonResponse(ListSchema, "Updated"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name, archived } = c.req.valid("json");
      const db = c.var.db;
      const before = await getList(db, id);
      const at = now();
      const archivedAt = archived === undefined ? before.archivedAt : archived ? (before.archivedAt ?? at) : null;
      const after: Row = { ...before, name: name ?? before.name, archivedAt, updatedAt: at };
      const type = archived === undefined ? "updated" : archived ? "archived" : "unarchived";
      await db.batch([
        db.update(lists).set({ name: after.name, archivedAt, updatedAt: at }).where(eq(lists.id, id)),
        eventQuery(db, { entityType: "list", entityId: id, type, before: toList(before), after: toList(after), actor: c.var.actor }),
      ]);
      return c.json(toList(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/lists/{id}/move",
      tags: tag,
      summary: "Move a list to another folder and/or reorder it",
      request: { params: IdParam, body: jsonBody(ListMoveSchema) },
      responses: { 200: jsonResponse(ListSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const before = await getList(db, id);
      const folderId = input.folderId === undefined ? before.folderId : input.folderId;
      await assertFolder(db, folderId);
      const after: Row = {
        ...before,
        folderId,
        position: await positionFor(db, lists, and(live, inFolder(folderId)), input),
        updatedAt: now(),
      };
      await db.batch([
        db.update(lists).set({ folderId, position: after.position, updatedAt: after.updatedAt }).where(eq(lists.id, id)),
        eventQuery(db, { entityType: "list", entityId: id, type: "moved", before: toList(before), after: toList(after), actor: c.var.actor }),
      ]);
      return c.json(toList(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/lists/{id}",
      tags: tag,
      summary: "Delete a list (soft). It must have no tasks.",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError, ...conflictError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const before = await getList(db, id);
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.listId, id), isNull(tasks.deletedAt))).limit(1);
      if (task) throw new ApiError(409, "not_empty", "Move or delete the list's tasks first");
      const at = now();
      await db.batch([
        db.update(lists).set({ deletedAt: at, updatedAt: at }).where(eq(lists.id, id)),
        eventQuery(db, { entityType: "list", entityId: id, type: "deleted", before: toList(before), actor: c.var.actor }),
      ]);
      return c.body(null, 204);
    },
  );
