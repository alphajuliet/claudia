import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

// Single source of truth for the API: the Worker derives the OpenAPI spec from
// these, and the web client and MCP tools reuse them.

export const CONTEXTS = ["work", "personal", "home"] as const;
export const TASK_KINDS = ["task", "heading"] as const;
export const RECUR_FROM = ["due", "completion"] as const;
export const ACTORS = ["web", "mcp", "shortcut", "cli", "import", "system"] as const;
export const SCOPES = ["read", "write", "admin"] as const;

export const HealthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("claudia"),
});
export type Health = z.infer<typeof HealthSchema>;

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
      issues: z.array(z.unknown()).optional(),
    }),
  })
  .openapi("Error");

export const IdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected a ULID");
export const IdParam = z.object({ id: IdSchema });

const Timestamp = z.string().datetime();
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// Where to place an item among its siblings. Omit both to append.
export const placementShape = { afterId: IdSchema.optional(), beforeId: IdSchema.optional() };
const notBoth = (p: { afterId?: string | undefined; beforeId?: string | undefined }) => !(p.afterId && p.beforeId);
const NOT_BOTH = "Give afterId or beforeId, not both";
export const PlacementSchema = z.object(placementShape).refine(notBoth, NOT_BOTH);

// Folders
export const FolderSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    parentId: IdSchema.nullable(),
    context: z.enum(CONTEXTS),
    position: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Folder");
export const FolderCreateSchema = z
  .object({
    name: z.string().min(1),
    context: z.enum(CONTEXTS),
    parentId: IdSchema.nullable().optional(),
  })
  .openapi("FolderCreate");
export const FolderUpdateSchema = FolderCreateSchema.partial().openapi("FolderUpdate");
export const FolderMoveSchema = z
  .object({ parentId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("FolderMove");

// Lists
export const ListSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    folderId: IdSchema.nullable(),
    position: z.string(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("List");
export const ListCreateSchema = z
  .object({ name: z.string().min(1), folderId: IdSchema.nullable().optional() })
  .openapi("ListCreate");
export const ListUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    archived: z.boolean().optional().openapi({ description: "Archive or unarchive the list" }),
  })
  .openapi("ListUpdate");
export const ListMoveSchema = z
  .object({ folderId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("ListMove");

// Tokens
export const TokenSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    scopes: z.array(z.enum(SCOPES)),
    lastUsedAt: Timestamp.nullable(),
    expiresAt: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .openapi("Token");
export const TokenCreateSchema = z
  .object({
    name: z.string().min(1),
    scopes: z.array(z.enum(SCOPES)).min(1),
    expiresAt: Timestamp.nullable().optional(),
  })
  .openapi("TokenCreate");
export const TokenCreatedSchema = TokenSchema.extend({
  token: z.string().openapi({ description: "The secret. Shown once; only its hash is stored." }),
}).openapi("TokenCreated");

export const MeSchema = z
  .object({
    name: z.string(),
    scopes: z.array(z.enum(SCOPES)),
    expiresAt: Timestamp.nullable(),
  })
  .openapi("Me");

export type Folder = z.infer<typeof FolderSchema>;
export type List = z.infer<typeof ListSchema>;
export type Token = z.infer<typeof TokenSchema>;
export type Me = z.infer<typeof MeSchema>;

// Labels
export const LabelNameSchema = z.string().trim().min(1).max(64);
export const LabelSchema = z
  .object({ id: IdSchema, name: z.string(), createdAt: Timestamp })
  .openapi("Label");
export const LabelCreateSchema = z.object({ name: LabelNameSchema }).openapi("LabelCreate");
export const LabelUpdateSchema = LabelCreateSchema.openapi("LabelUpdate");

// Tasks. `kind: "heading"` rows are section headings within a list.
export const TaskSchema = z
  .object({
    id: IdSchema,
    listId: IdSchema,
    parentId: IdSchema.nullable(),
    kind: z.enum(TASK_KINDS),
    position: z.string(),
    title: z.string(),
    notes: z.string().nullable(),
    dueDate: DateOnly.nullable(),
    dueAt: Timestamp.nullable(),
    startDate: DateOnly.nullable(),
    snoozedUntil: Timestamp.nullable(),
    recurRule: z.string().nullable().openapi({ example: "FREQ=WEEKLY;BYDAY=MO" }),
    recurFrom: z.enum(RECUR_FROM).nullable(),
    completedAt: Timestamp.nullable(),
    labels: z.array(z.string()).openapi({ description: "Label names" }),
    metadata: z.record(z.unknown()).nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Task");

export const taskFieldShapes = {
  title: z.string().min(1),
  notes: z.string().nullable(),
  dueDate: DateOnly.nullable(),
  dueAt: Timestamp.nullable(),
  startDate: DateOnly.nullable(),
  snoozedUntil: Timestamp.nullable(),
  recurRule: z.string().min(1).nullable(),
  recurFrom: z.enum(RECUR_FROM).nullable(),
  labels: z.array(LabelNameSchema).openapi({ description: "Replaces the task's labels; missing ones are created" }),
  metadata: z.record(z.unknown()).nullable(),
};

export const taskCreateShape = {
  listId: IdSchema,
  parentId: IdSchema.nullable().optional(),
  kind: z.enum(TASK_KINDS).optional(),
  title: taskFieldShapes.title,
  notes: taskFieldShapes.notes.optional(),
  dueDate: taskFieldShapes.dueDate.optional(),
  dueAt: taskFieldShapes.dueAt.optional(),
  startDate: taskFieldShapes.startDate.optional(),
  snoozedUntil: taskFieldShapes.snoozedUntil.optional(),
  recurRule: taskFieldShapes.recurRule.optional(),
  recurFrom: taskFieldShapes.recurFrom.optional(),
  labels: taskFieldShapes.labels.optional(),
  metadata: taskFieldShapes.metadata.optional(),
};

export const TaskCreateSchema = z
  .object({ ...taskCreateShape, ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("TaskCreate");

export const TaskUpdateSchema = z.object(taskFieldShapes).partial().openapi("TaskUpdate");

export const TaskMoveSchema = z
  .object({ listId: IdSchema.optional(), parentId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("TaskMove");

export const TaskQuerySchema = z.object({
  listId: IdSchema.optional(),
  parentId: IdSchema.optional(),
  status: z.enum(["open", "completed", "all"]).default("open"),
  label: z.string().optional().openapi({ description: "Only tasks with this label (name, case-insensitive)" }),
  dueBefore: DateOnly.optional().openapi({ description: "Due date on or before" }),
  dueAfter: DateOnly.optional().openapi({ description: "Due date on or after" }),
  q: z.string().optional().openapi({ description: "Case-insensitive match on title or notes" }),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Task = z.infer<typeof TaskSchema>;
export type Label = z.infer<typeof LabelSchema>;

// Saved filters (smart lists). `query` is a query string for GET /api/tasks,
// e.g. "label=next&dueBefore=2026-11-01".
export const FilterSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    query: z.string().openapi({ example: "label=next&status=open" }),
    position: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi("Filter");
export const FilterCreateSchema = z
  .object({ name: z.string().min(1), query: z.string() })
  .openapi("FilterCreate");
export const FilterUpdateSchema = FilterCreateSchema.partial().openapi("FilterUpdate");
export const FilterMoveSchema = PlacementSchema.openapi("FilterMove");
export const FilterRunQuerySchema = z.object({
  limit: TaskQuerySchema.shape.limit.optional(),
  offset: TaskQuerySchema.shape.offset.optional(),
});

// Settings: single-user key/value JSON (e.g. `keymap`, `timeZone`).
export const SettingKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9._-]{0,63}$/, "Letters, digits, . _ - ; start with a lowercase letter");
export const SettingKeyParam = z.object({ key: SettingKeySchema });
export const SettingValueSchema = z
  .object({ value: z.any() })
  .refine((o) => "value" in o, "value is required")
  .openapi("SettingValue");
export const SettingSchema = z
  .object({ key: z.string(), value: z.any(), updatedAt: Timestamp })
  .openapi("Setting");

export type Filter = z.infer<typeof FilterSchema>;
export type Setting = z.infer<typeof SettingSchema>;

// Import: bulk insert with caller-supplied IDs and timestamps, for migrating
// from another task manager. Existing IDs are skipped, so it is safe to re-run.
export const IMPORT_MAX_ITEMS = 100;

const ImportFolder = z.object({
  id: IdSchema, name: z.string().min(1), parentId: IdSchema.nullable(), context: z.enum(CONTEXTS),
  position: z.string().min(1), createdAt: Timestamp, updatedAt: Timestamp,
});
const ImportList = z.object({
  id: IdSchema, name: z.string().min(1), folderId: IdSchema.nullable(), position: z.string().min(1),
  archivedAt: Timestamp.nullable(), createdAt: Timestamp, updatedAt: Timestamp,
});
const ImportLabel = z.object({ id: IdSchema, name: LabelNameSchema, createdAt: Timestamp });
const ImportTask = z.object({
  id: IdSchema, listId: IdSchema, parentId: IdSchema.nullable(), kind: z.enum(TASK_KINDS),
  position: z.string().min(1), title: z.string().min(1), notes: z.string().nullable(),
  dueDate: DateOnly.nullable(), dueAt: Timestamp.nullable(), startDate: DateOnly.nullable(),
  snoozedUntil: Timestamp.nullable(), recurRule: z.string().min(1).nullable(),
  recurFrom: z.enum(RECUR_FROM).nullable(), completedAt: Timestamp.nullable(),
  metadata: z.record(z.unknown()).nullable(), labelIds: z.array(IdSchema),
  createdAt: Timestamp, updatedAt: Timestamp,
}).refine((t) => (t.recurRule === null) === (t.recurFrom === null), "recurRule and recurFrom must be set together");

export const ImportSchema = z
  .object({
    folders: z.array(ImportFolder).default([]),
    lists: z.array(ImportList).default([]),
    labels: z.array(ImportLabel).default([]),
    tasks: z.array(ImportTask).default([]),
  })
  .refine(
    (b) => b.folders.length + b.lists.length + b.labels.length + b.tasks.length <= IMPORT_MAX_ITEMS,
    `At most ${IMPORT_MAX_ITEMS} items per request`,
  )
  .openapi("Import");

const Counts = z.object({ folders: z.number(), lists: z.number(), labels: z.number(), tasks: z.number() });
export const ImportResultSchema = z
  .object({ inserted: Counts, skipped: Counts })
  .openapi("ImportResult");
export type ImportBatch = z.infer<typeof ImportSchema>;
