import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { SettingKeyParam, SettingSchema, SettingValueSchema } from "@claudia/shared";
import { settings } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { now } from "../lib/ids";
import { commonErrors, jsonBody, jsonResponse, newRouter, notFoundError } from "../lib/router";

const tag = ["Settings"];
type Row = typeof settings.$inferSelect;

const toSetting = (r: Row) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt });

async function getSetting(db: Db, key: string): Promise<Row> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) throw notFound("Setting");
  return row;
}

export const settingRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/settings",
      tags: tag,
      summary: "All settings as a key/value object",
      description: "Known keys: `keymap` (user key bindings) and `timeZone`.",
      responses: { 200: jsonResponse(z.record(z.any()), "Settings"), ...commonErrors },
    }),
    async (c) => {
      const rows = await c.var.db.select().from(settings);
      return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])), 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/settings/{key}",
      tags: tag,
      summary: "Get one setting",
      request: { params: SettingKeyParam },
      responses: { 200: jsonResponse(SettingSchema, "Setting"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(toSetting(await getSetting(c.var.db, c.req.valid("param").key)), 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/api/settings/{key}",
      tags: tag,
      summary: "Set a setting, replacing any existing value",
      request: { params: SettingKeyParam, body: jsonBody(SettingValueSchema) },
      responses: { 200: jsonResponse(SettingSchema, "Saved"), ...commonErrors },
    }),
    async (c) => {
      const { key } = c.req.valid("param");
      const { value } = c.req.valid("json");
      const db = c.var.db;
      const [before] = await db.select().from(settings).where(eq(settings.key, key));
      const row: Row = { key, value: value ?? null, updatedAt: now() };
      await runBatch(db, [
        db.insert(settings).values(row).onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: row.updatedAt } }),
        eventQuery(db, {
          entityType: "setting",
          entityId: key,
          type: before ? "updated" : "created",
          before: before?.value,
          after: row.value,
          actor: c.var.actor,
        }),
      ]);
      return c.json(toSetting(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/settings/{key}",
      tags: tag,
      summary: "Remove a setting (reverts to the default)",
      request: { params: SettingKeyParam },
      responses: { 204: { description: "Removed" }, ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { key } = c.req.valid("param");
      const db = c.var.db;
      const before = await getSetting(db, key);
      await runBatch(db, [
        db.delete(settings).where(eq(settings.key, key)),
        eventQuery(db, { entityType: "setting", entityId: key, type: "deleted", before: before.value, actor: c.var.actor }),
      ]);
      return c.body(null, 204);
    },
  );
