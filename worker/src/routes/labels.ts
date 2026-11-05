import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { IdParam, LabelCreateSchema, LabelSchema, LabelUpdateSchema } from "@claudia/shared";
import { labels, taskLabels } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { now } from "../lib/ids";
import { resolveLabelIds } from "../lib/labels";
import {
  commonErrors,
  conflictError,
  jsonBody,
  jsonResponse,
  newRouter,
  notFoundError,
} from "../lib/router";

const tag = ["Labels"];
type Row = typeof labels.$inferSelect;
const toLabel = (r: Row) => ({ id: r.id, name: r.name, color: r.color ?? null, createdAt: r.createdAt });
const live = isNull(labels.deletedAt);

async function getLabel(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(labels).where(and(eq(labels.id, id), live));
  if (!row) throw notFound("Label");
  return row;
}

async function assertNameFree(db: Db, name: string, exceptId?: string) {
  const [clash] = await db.select().from(labels).where(sql`lower(${labels.name}) = lower(${name})`);
  if (clash && clash.id !== exceptId && !clash.deletedAt) {
    throw new ApiError(409, "name_taken", `A label named '${clash.name}' already exists`);
  }
  return clash;
}

export const labelRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/labels",
      tags: tag,
      summary: "List labels",
      responses: { 200: jsonResponse(z.array(LabelSchema), "Labels"), ...commonErrors },
    }),
    async (c) => {
      const rows = await c.var.db.select().from(labels).where(live).orderBy(asc(labels.name));
      return c.json(rows.map(toLabel), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/labels",
      tags: tag,
      summary: "Create a label",
      request: { body: jsonBody(LabelCreateSchema) },
      responses: { 201: jsonResponse(LabelSchema, "Created"), ...commonErrors, ...conflictError },
    }),
    async (c) => {
      const { name, color } = c.req.valid("json");
      const db = c.var.db;
      await assertNameFree(db, name);
      const { ids, pending } = await resolveLabelIds(db, [name], c.var.actor);
      await runBatch(db, pending);
      const id = ids[0]!;
      if (color) {
        await db.batch([
          db.update(labels).set({ color }).where(eq(labels.id, id)),
          eventQuery(db, { entityType: "label", entityId: id, type: "updated", before: { color: null }, after: { color }, actor: c.var.actor }),
        ]);
      }
      return c.json(toLabel(await getLabel(db, id)), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/labels/{id}",
      tags: tag,
      summary: "Rename a label or change its colour",
      request: { params: IdParam, body: jsonBody(LabelUpdateSchema) },
      responses: { 200: jsonResponse(LabelSchema, "Updated"), ...commonErrors, ...notFoundError, ...conflictError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name, color } = c.req.valid("json");
      const db = c.var.db;
      const before = await getLabel(db, id);
      const renamed = name !== undefined && name !== before.name;
      const recoloured = color !== undefined && color !== before.color;
      if (renamed) {
        const clash = await assertNameFree(db, name, id);
        if (clash?.deletedAt) {
          // Free the name held by a deleted label.
          await db.update(labels).set({ name: `${clash.name} (deleted ${clash.id})` }).where(eq(labels.id, clash.id));
        }
      }
      const after = { ...before, ...(renamed ? { name } : {}), ...(recoloured ? { color } : {}) };
      if (renamed || recoloured) {
        await db.batch([
          db.update(labels).set({ name: after.name, color: after.color }).where(eq(labels.id, id)),
          eventQuery(db, {
            entityType: "label",
            entityId: id,
            // A rename keeps its own event type, so history reads as before.
            type: renamed ? "renamed" : "updated",
            before: { ...(renamed ? { name: before.name } : {}), ...(recoloured ? { color: before.color } : {}) },
            after: { ...(renamed ? { name } : {}), ...(recoloured ? { color } : {}) },
            actor: c.var.actor,
          }),
        ]);
      }
      return c.json(toLabel(after), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/labels/{id}",
      tags: tag,
      summary: "Delete a label and remove it from all tasks",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const before = await getLabel(db, id);
      await db.batch([
        db.delete(taskLabels).where(eq(taskLabels.labelId, id)),
        db.update(labels).set({ deletedAt: now() }).where(eq(labels.id, id)),
        eventQuery(db, { entityType: "label", entityId: id, type: "deleted", before: { name: before.name }, actor: c.var.actor }),
      ]);
      return c.body(null, 204);
    },
  );
