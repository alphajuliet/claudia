import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;

/** Run statements atomically: D1 has no interactive transactions, only batches. */
export const runBatch = (db: Db, statements: BatchItem<"sqlite">[]) =>
  db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
