import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { ApiError } from "./errors";

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;

/** Run statements atomically: D1 has no interactive transactions, only batches. */
export const runBatch = (db: Db, statements: BatchItem<"sqlite">[]) =>
  db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

/** Whether `e` (or an error it wraps) is SQLite refusing a duplicate in a unique index. */
export function isUniqueConflict(e: unknown): boolean {
  for (let err = e, depth = 0; err && depth < 5; err = (err as { cause?: unknown }).cause, depth++) {
    if (/UNIQUE constraint failed/i.test(String((err as { message?: unknown }).message ?? err))) return true;
  }
  return false;
}

/**
 * Runs `work` again when it hits a unique index: another request placed an item (or made a label) between this
 * one's reads and its batch. A batch is all or nothing, so the failed try left nothing behind; the next try reads
 * afresh. `work` must write in one batch only. Gives up with a 409 after `attempts` tries.
 */
export async function retryOnConflict<T>(work: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (e) {
      if (!isUniqueConflict(e)) throw e;
      if (i >= attempts) throw new ApiError(409, "conflict", "Too many changes at once; try again");
      // A short random wait, so requests that clashed don't clash again in step.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * i));
    }
  }
}
