import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  FolderCreateSchema,
  FolderMoveSchema,
  FolderSchema,
  FolderUpdateSchema,
  IdParam,
} from "@claudia/shared";
import { folders, lists } from "../db/schema";
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

const tag = ["Folders"];
type Row = typeof folders.$inferSelect;

export const toFolder = (r: Row) => ({
  id: r.id,
  name: r.name,
  parentId: r.parentId,
  context: r.context,
  position: r.position,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const live = isNull(folders.deletedAt);
const sameParent = (parentId: string | null) =>
  parentId === null ? isNull(folders.parentId) : eq(folders.parentId, parentId);

async function getFolder(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(folders).where(and(eq(folders.id, id), live));
  if (!row) throw notFound("Folder");
  return row;
}

/** A folder can't sit inside itself or one of its own descendants. */
async function assertNoCycle(db: Db, id: string, newParentId: string | null) {
  for (let cursor = newParentId; cursor; ) {
    if (cursor === id) throw new ApiError(422, "invalid_parent", "A folder can't be moved inside itself");
    cursor = (await getFolder(db, cursor)).parentId;
  }
}

export const folderRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/folders",
      tags: tag,
      summary: "List folders in display order",
      responses: { 200: jsonResponse(z.array(FolderSchema), "Folders"), ...commonErrors },
    }),
    async (c) => {
      const rows = await c.var.db.select().from(folders).where(live).orderBy(asc(folders.position));
      return c.json(rows.map(toFolder), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/folders",
      tags: tag,
      summary: "Create a folder",
      request: { body: jsonBody(FolderCreateSchema) },
      responses: { 201: jsonResponse(FolderSchema, "Created"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const parentId = input.parentId ?? null;
      if (parentId) await getFolder(db, parentId);
      const at = now();
      const row: Row = {
        id: newId(),
        name: input.name,
        parentId,
        context: input.context,
        position: await positionFor(db, folders, and(live, sameParent(parentId))),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      await db.batch([
        db.insert(folders).values(row),
        eventQuery(db, { entityType: "folder", entityId: row.id, type: "created", after: toFolder(row), actor: c.var.actor }),
      ]);
      return c.json(toFolder(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/folders/{id}",
      tags: tag,
      summary: "Get a folder",
      request: { params: IdParam },
      responses: { 200: jsonResponse(FolderSchema, "Folder"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(toFolder(await getFolder(c.var.db, c.req.valid("param").id)), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/folders/{id}",
      tags: tag,
      summary: "Rename a folder or change its context",
      request: { params: IdParam, body: jsonBody(FolderUpdateSchema) },
      responses: { 200: jsonResponse(FolderSchema, "Updated"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name, context } = c.req.valid("json");
      const db = c.var.db;
      const before = await getFolder(db, id);
      const after: Row = { ...before, name: name ?? before.name, context: context ?? before.context, updatedAt: now() };
      await db.batch([
        db.update(folders).set({ name: after.name, context: after.context, updatedAt: after.updatedAt }).where(eq(folders.id, id)),
        eventQuery(db, { entityType: "folder", entityId: id, type: "updated", before: toFolder(before), after: toFolder(after), actor: c.var.actor }),
      ]);
      return c.json(toFolder(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/folders/{id}/move",
      tags: tag,
      summary: "Move a folder under another parent and/or reorder it",
      request: { params: IdParam, body: jsonBody(FolderMoveSchema) },
      responses: { 200: jsonResponse(FolderSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const before = await getFolder(db, id);
      const parentId = input.parentId === undefined ? before.parentId : input.parentId;
      if (parentId) await getFolder(db, parentId);
      await assertNoCycle(db, id, parentId);
      const after: Row = {
        ...before,
        parentId,
        position: await positionFor(db, folders, and(live, sameParent(parentId)), input),
        updatedAt: now(),
      };
      await db.batch([
        db.update(folders).set({ parentId, position: after.position, updatedAt: after.updatedAt }).where(eq(folders.id, id)),
        eventQuery(db, { entityType: "folder", entityId: id, type: "moved", before: toFolder(before), after: toFolder(after), actor: c.var.actor }),
      ]);
      return c.json(toFolder(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/folders/{id}",
      tags: tag,
      summary: "Delete a folder (soft). It must be empty.",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError, ...conflictError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const before = await getFolder(db, id);
      const [child] = await db.select({ id: folders.id }).from(folders).where(and(live, eq(folders.parentId, id))).limit(1);
      const [list] = await db.select({ id: lists.id }).from(lists).where(and(isNull(lists.deletedAt), eq(lists.folderId, id))).limit(1);
      if (child || list) throw new ApiError(409, "not_empty", "Move or delete the folder's contents first");
      const at = now();
      await db.batch([
        db.update(folders).set({ deletedAt: at, updatedAt: at }).where(eq(folders.id, id)),
        eventQuery(db, { entityType: "folder", entityId: id, type: "deleted", before: toFolder(before), actor: c.var.actor }),
      ]);
      return c.body(null, 204);
    },
  );
