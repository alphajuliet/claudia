import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { ACTORS, tokens } from "../db/schema";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { now } from "./ids";
import { internalKey } from "./internal";
import type { Actor, AppEnv, Scope } from "./router";

const PREFIX = "cl_";
const LAST_USED_GRANULARITY_MS = 60 * 60 * 1000;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function generateToken(): string {
  return PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Each scope implies the ones below it: admin > write > read.
const RANK: Record<Scope, number> = { read: 1, write: 2, admin: 3 };

const requiredScope = (method: string, path: string): Scope =>
  path.startsWith("/api/tokens") || path.startsWith("/api/import") ? "admin" : method === "GET" || method === "HEAD" ? "read" : "write";

const allows = (held: readonly Scope[], needed: Scope) =>
  Math.max(0, ...held.map((s) => RANK[s])) >= RANK[needed];

/** Constant-time comparison of two strings of equal length. */
const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** The live stored token for a bearer secret, or null. Notes use at most hourly. */
export async function lookupToken(db: Db, secret: string) {
  if (!secret.startsWith(PREFIX)) return null;
  const [row] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.hash, await hashToken(secret)), isNull(tokens.revokedAt)));
  if (!row || (row.expiresAt && row.expiresAt <= now())) return null;
  if (!row.lastUsedAt || Date.parse(row.lastUsedAt) < Date.now() - LAST_USED_GRANULARITY_MS) {
    await db.update(tokens).set({ lastUsedAt: now() }).where(eq(tokens.id, row.id));
  }
  return row;
}

/**
 * Bearer-token authentication. The web app's Cloudflare Access path is added
 * with the domain setup; until then every caller presents a token.
 */
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  // In-process calls from the MCP handler for an OAuth grant. The key is random per isolate.
  // Admin is never granted; a wrong key falls through to the normal bearer check.
  const internal = c.req.header("X-Claudia-Internal");
  if (internal && timingSafeEqual(internal, internalKey())) {
    const granted = (c.req.header("X-Claudia-Scopes") ?? "").split(",").filter((s): s is Scope => s === "read" || s === "write");
    const needed = requiredScope(c.req.method, c.req.path);
    if (!allows(granted, needed)) throw new ApiError(403, "forbidden", `This connection needs the '${needed}' scope`);
    c.set("actor", "mcp");
    c.set("scopes", granted);
    c.set("identity", { name: "MCP connection", expiresAt: null });
    await next();
    return;
  }

  const header = c.req.header("Authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = await lookupToken(c.var.db, secret);
  if (!row) throw new ApiError(401, "unauthorized", "Missing or invalid token");

  const needed = requiredScope(c.req.method, c.req.path);
  if (!allows(row.scopes as Scope[], needed)) {
    throw new ApiError(403, "forbidden", `This token needs the '${needed}' scope`);
  }

  // The caller says which client it is; this is audit information, not authorisation.
  const claimed = c.req.header("X-Claudia-Client") as Actor | undefined;
  c.set("actor", claimed && ACTORS.includes(claimed) && claimed !== "system" ? claimed : "cli");
  c.set("scopes", row.scopes as Scope[]);
  c.set("identity", { name: row.name, expiresAt: row.expiresAt });
  await next();
});
