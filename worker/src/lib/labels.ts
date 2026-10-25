import type { BatchItem } from "drizzle-orm/batch";
import { eq, inArray, sql } from "drizzle-orm";
import { labels } from "../db/schema";
import type { Db } from "./db";
import { eventQuery } from "./events";
import { newId, now } from "./ids";
import type { Actor } from "./router";

/** D1 allows 100 bound parameters per statement. */
export const chunk = <T>(items: T[], size = 90): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Turn label names into ids. Names are case-insensitive; labels that don't
 * exist are created and soft-deleted ones are revived. The returned `pending`
 * statements must run in the same batch as the change that uses the ids.
 */
export async function resolveLabelIds(
  db: Db,
  names: string[],
  actor: Actor,
): Promise<{ ids: string[]; names: string[]; pending: BatchItem<"sqlite">[] }> {
  const wanted = new Map<string, string>(); // lowercase -> name as given first
  for (const n of names) if (!wanted.has(n.toLowerCase())) wanted.set(n.toLowerCase(), n);

  const found = new Map<string, typeof labels.$inferSelect>();
  for (const part of chunk([...wanted.keys()])) {
    const rows = await db.select().from(labels).where(inArray(sql`lower(${labels.name})`, part));
    for (const r of rows) found.set(r.name.toLowerCase(), r);
  }

  const ids: string[] = [];
  const canonical: string[] = [];
  const pending: BatchItem<"sqlite">[] = [];
  for (const [key, name] of wanted) {
    const existing = found.get(key);
    if (existing) {
      ids.push(existing.id);
      canonical.push(existing.name);
      if (existing.deletedAt) {
        pending.push(
          db.update(labels).set({ deletedAt: null }).where(eq(labels.id, existing.id)),
          eventQuery(db, { entityType: "label", entityId: existing.id, type: "restored", after: { name: existing.name }, actor }),
        );
      }
    } else {
      const id = newId();
      ids.push(id);
      canonical.push(name);
      pending.push(
        db.insert(labels).values({ id, name, createdAt: now() }),
        eventQuery(db, { entityType: "label", entityId: id, type: "created", after: { name }, actor }),
      );
    }
  }
  return { ids, names: canonical.sort((a, b) => a.localeCompare(b)), pending };
}
