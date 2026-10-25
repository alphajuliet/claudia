import { generateKeyBetween } from "fractional-indexing";
import { and, asc, desc, eq, gt, isNull, lt, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./db";
import { ApiError } from "./errors";

// A table that can be ordered: `id`, `position` and `deleted_at` columns, plus
// the sibling scope (e.g. same parent folder).
interface Orderable extends SQLiteTable {
  id: SQLiteColumn;
  position: SQLiteColumn;
  deletedAt: SQLiteColumn;
}

export interface Placement {
  afterId?: string | undefined;
  beforeId?: string | undefined;
}

/**
 * The fractional index for an item among `scope` siblings: after `afterId`,
 * before `beforeId`, or at the end.
 */
export async function positionFor(
  db: Db,
  table: Orderable,
  scope: SQL | undefined,
  { afterId, beforeId }: Placement = {},
): Promise<string> {
  const live = and(scope, isNull(table.deletedAt));

  const positionOf = async (id: string) => {
    const [row] = await db
      .select({ position: table.position })
      .from(table)
      .where(and(live, eq(table.id, id)));
    if (!row) throw new ApiError(422, "invalid_placement", `Sibling ${id} not found in this scope`);
    return row.position as string;
  };
  const neighbour = async (than: SQL, order: SQL) => {
    const [row] = await db.select({ position: table.position }).from(table).where(and(live, than)).orderBy(order).limit(1);
    return (row?.position as string | undefined) ?? null;
  };

  if (afterId) {
    const a = await positionOf(afterId);
    return generateKeyBetween(a, await neighbour(gt(table.position, a), asc(table.position)));
  }
  if (beforeId) {
    const b = await positionOf(beforeId);
    return generateKeyBetween(await neighbour(lt(table.position, b), desc(table.position)), b);
  }
  return generateKeyBetween(await neighbour(gt(table.position, ""), desc(table.position)), null);
}
