import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Conventions
// - IDs are ULIDs (text). Timestamps are ISO 8601 UTC strings; date-only
//   fields are YYYY-MM-DD.
// - `position` is a fractional index (text); sorts correctly under BINARY collation.
// - Deletes are soft (`deleted_at`). Every change also writes a row to `events`.

export const CONTEXTS = ["work", "personal", "home"] as const;
export const TASK_KINDS = ["task", "heading"] as const;
export const RECUR_FROM = ["due", "completion"] as const;
export const ACTORS = ["web", "mcp", "shortcut", "cli", "import", "system"] as const;
export const ENTITY_TYPES = ["folder", "list", "task", "label", "filter", "setting", "token"] as const;

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull();
const updatedAt = () => text("updated_at").notNull();
const deletedAt = () => text("deleted_at");

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

export const folders = sqliteTable(
  "folders",
  {
    id: id(),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => folders.id),
    context: text("context", { enum: CONTEXTS }).notNull(),
    position: text("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("folders_parent_idx").on(t.parentId, t.position),
    check("folders_context_check", oneOf("context", CONTEXTS)),
  ],
);

export const lists = sqliteTable(
  "lists",
  {
    id: id(),
    name: text("name").notNull(),
    folderId: text("folder_id").references(() => folders.id),
    position: text("position").notNull(),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("lists_folder_idx").on(t.folderId, t.position)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id),
    parentId: text("parent_id").references((): AnySQLiteColumn => tasks.id),
    kind: text("kind", { enum: TASK_KINDS }).notNull().default("task"),
    position: text("position").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    dueDate: text("due_date"),
    dueAt: text("due_at"),
    startDate: text("start_date"),
    snoozedUntil: text("snoozed_until"),
    recurRule: text("recur_rule"),
    recurFrom: text("recur_from", { enum: RECUR_FROM }),
    completedAt: text("completed_at"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("tasks_list_idx").on(t.listId, t.position),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_due_date_idx").on(t.dueDate),
    index("tasks_completed_idx").on(t.completedAt),
    check("tasks_kind_check", oneOf("kind", TASK_KINDS)),
    check(
      "tasks_recur_from_check",
      sql`${t.recurFrom} IS NULL OR ${oneOf("recur_from", RECUR_FROM)}`,
    ),
    check("tasks_recur_pair_check", sql`(${t.recurRule} IS NULL) = (${t.recurFrom} IS NULL)`),
  ],
);

// A label's name is the state (wip, waitingOn, next, someday, ...).
export const labels = sqliteTable(
  "labels",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("labels_name_unique").on(sql`lower(${t.name})`)],
);

export const taskLabels = sqliteTable(
  "task_labels",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index("task_labels_label_idx").on(t.labelId)],
);

// Append-only: triggers in the migrations reject UPDATE and DELETE.
export const events = sqliteTable(
  "events",
  {
    id: id(),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    type: text("type").notNull(),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
    at: text("at").notNull(),
    actor: text("actor", { enum: ACTORS }).notNull(),
  },
  (t) => [
    index("events_entity_idx").on(t.entityType, t.entityId, t.at),
    index("events_type_idx").on(t.type, t.at),
    check("events_actor_check", oneOf("actor", ACTORS)),
    check("events_entity_type_check", oneOf("entity_type", ENTITY_TYPES)),
  ],
);

// Saved queries: the smart lists.
export const filters = sqliteTable("filters", {
  id: id(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  position: text("position").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

// Single-user key/value store (keymap, time zone, ...).
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

export const tokens = sqliteTable(
  "tokens",
  {
    id: id(),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tokens_hash_unique").on(t.hash)],
);
