/**
 * Folders: the rule that a folder's context follows its parent's. The sidebar shows a subfolder only in its own
 * context, so a subfolder whose context differs from its parent's would vanish from the parent's context. Creating,
 * moving and changing a folder's context therefore set the context of everything under it too.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { CONTEXTS } from "@claudia/shared";
import { folders } from "../db/schema";
import type { Db } from "../lib/db";
import { eventQuery } from "../lib/events";
import type { Actor } from "../lib/router";

type Context = (typeof CONTEXTS)[number];

/** The live folders under `id`, at every level (not `id` itself). */
export async function descendantFolders(db: Db, id: string) {
  const out: (typeof folders.$inferSelect)[] = [];
  for (let level = [id]; level.length > 0; ) {
    const rows = await db.select().from(folders).where(and(inArray(folders.parentId, level), isNull(folders.deletedAt)));
    out.push(...rows);
    level = rows.map((r) => r.id);
  }
  return out;
}

/**
 * Statements giving the folders under `id` the context `context`, each with an `updated` event, for the batch that
 * changes `id` itself. Folders that already have it are left alone.
 */
export async function cascadeContext(db: Db, actor: Actor, id: string, context: Context, at: string): Promise<BatchItem<"sqlite">[]> {
  const statements: BatchItem<"sqlite">[] = [];
  for (const row of await descendantFolders(db, id)) {
    if (row.context === context) continue;
    statements.push(
      db.update(folders).set({ context, updatedAt: at }).where(eq(folders.id, row.id)),
      eventQuery(db, { entityType: "folder", entityId: row.id, type: "updated", before: { context: row.context }, after: { context }, actor }),
    );
  }
  return statements;
}
