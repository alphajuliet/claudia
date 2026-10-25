import type { Db } from "./db";
import { events, type ACTORS, type ENTITY_TYPES } from "../db/schema";
import { newId, now } from "./ids";

export interface EventInput {
  entityType: (typeof ENTITY_TYPES)[number];
  entityId: string;
  type: string;
  before?: unknown;
  after?: unknown;
  actor: (typeof ACTORS)[number];
}

/**
 * An insert for the append-only log. Run it in `db.batch([...])` together with
 * the change it records, so both land or neither does.
 */
export const eventQuery = (db: Db, e: EventInput) =>
  db.insert(events).values({
    id: newId(),
    entityType: e.entityType,
    entityId: e.entityId,
    type: e.type,
    before: e.before ?? null,
    after: e.after ?? null,
    at: now(),
    actor: e.actor,
  });
