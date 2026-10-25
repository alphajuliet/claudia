import { createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  IdParam,
  TokenCreateSchema,
  TokenCreatedSchema,
  TokenSchema,
} from "@claudia/shared";
import { tokens } from "../db/schema";
import { generateToken, hashToken } from "../lib/auth";
import { notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { newId, now } from "../lib/ids";
import { commonErrors, jsonBody, jsonResponse, newRouter, notFoundError } from "../lib/router";

const tag = ["Tokens"];

const toToken = (r: typeof tokens.$inferSelect) => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes as z.infer<typeof TokenSchema>["scopes"],
  lastUsedAt: r.lastUsedAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt,
  createdAt: r.createdAt,
});

export const tokenRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/tokens",
      tags: tag,
      summary: "List API tokens (never their secrets)",
      responses: { 200: jsonResponse(z.array(TokenSchema), "Tokens"), ...commonErrors },
    }),
    async (c) => {
      const rows = await c.var.db.select().from(tokens).orderBy(desc(tokens.createdAt));
      return c.json(rows.map(toToken), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tokens",
      tags: tag,
      summary: "Create an API token",
      description: "The secret is returned once. Only its SHA-256 hash is stored.",
      request: { body: jsonBody(TokenCreateSchema) },
      responses: { 201: jsonResponse(TokenCreatedSchema, "Created"), ...commonErrors },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const secret = generateToken();
      const row = {
        id: newId(),
        name: input.name,
        hash: await hashToken(secret),
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        createdAt: now(),
      };
      await db.batch([
        db.insert(tokens).values(row),
        eventQuery(db, {
          entityType: "token",
          entityId: row.id,
          type: "created",
          after: { name: row.name, scopes: row.scopes },
          actor: c.var.actor,
        }),
      ]);
      return c.json({ ...toToken({ ...row, lastUsedAt: null, revokedAt: null }), token: secret }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/tokens/{id}",
      tags: tag,
      summary: "Revoke an API token",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TokenSchema, "Revoked"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const [row] = await db.select().from(tokens).where(and(eq(tokens.id, id), isNull(tokens.revokedAt)));
      if (!row) throw notFound("Token");
      const revokedAt = now();
      await db.batch([
        db.update(tokens).set({ revokedAt }).where(eq(tokens.id, id)),
        eventQuery(db, {
          entityType: "token",
          entityId: id,
          type: "revoked",
          before: { name: row.name },
          actor: c.var.actor,
        }),
      ]);
      return c.json(toToken({ ...row, revokedAt }), 200);
    },
  );
