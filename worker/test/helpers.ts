import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { app } from "../src";
import * as schema from "../src/db/schema";
import { generateToken, hashToken } from "../src/lib/auth";
import { newId, now } from "../src/lib/ids";

export const db = drizzle(env.DB, { schema });

export async function makeToken(scopes: string[] = ["admin"], extra: Partial<typeof schema.tokens.$inferInsert> = {}) {
  const secret = generateToken();
  await db.insert(schema.tokens).values({
    id: newId(), name: "test", hash: await hashToken(secret), scopes, createdAt: now(), ...extra,
  });
  return secret;
}

/** Wipe everything except `events` (append-only) between tests. */
export async function reset() {
  for (const t of [schema.taskLabels, schema.tasks, schema.labels, schema.lists, schema.folders, schema.filters, schema.settings, schema.tokens]) {
    await db.delete(t);
  }
}

export function client(token?: string, headers: Record<string, string> = {}) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}
