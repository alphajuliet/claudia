// worker/src/mcp/tools.ts
import {
  CONTEXTS,
  IdSchema,
  LabelNameSchema,
  TaskQuerySchema,
  placementShape,
  taskCreateShape,
  taskFieldShapes,
} from "@claudia/shared";
import { z } from "zod";

export interface ApiRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  access: "read" | "write";
  input: S;
  request: (args: z.infer<S>) => ApiRequest;
}

const tool = <S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef => def as unknown as ToolDef;

const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const id = (what: string) => IdSchema.describe(`ID of the ${what} (a 26-character ULID from a list or search result)`);
const noId = <T extends { id: string }>(args: T): Omit<T, "id"> => {
  const { id: _id, ...rest } = args;
  return rest;
};
const placement = {
  afterId: placementShape.afterId.describe("Place directly after this sibling. Omit both afterId and beforeId to place last."),
  beforeId: placementShape.beforeId.describe("Place directly before this sibling."),
};
const notBoth = (p: { afterId?: string | undefined; beforeId?: string | undefined }) => !(p.afterId && p.beforeId);
const withPlacement = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, ...placement }).strict().refine(notBoth, "Give afterId or beforeId, not both");

const CONVENTIONS =
  " Dates are YYYY-MM-DD. Labels hold state (for example next, wip, waitingOn, someday). IDs are ULIDs taken from earlier results.";

export const TOOLS: ToolDef[] = [
  // ---- Read
  tool({
    name: "search_tasks",
    description:
      "Find tasks. Returns open tasks by default, in list order, up to 50 at a time (use offset to page). Combine filters to build smart lists: list, label, due range, text." + CONVENTIONS,
    access: "read",
    input: TaskQuerySchema.extend({
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    request: (a) => ({ method: "GET", path: "/api/tasks", query: { ...a } }),
  }),
  tool({
    name: "get_task",
    description: "Get one task, with its labels, dates and notes.",
    access: "read",
    input: strict({ id: id("task") }),
    request: (a) => ({ method: "GET", path: `/api/tasks/${a.id}` }),
  }),
  tool({
    name: "run_filter",
    description: "Run a saved filter (smart list) and return its matching tasks.",
    access: "read",
    input: strict({ id: id("filter"), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }),
    request: (a) => ({ method: "GET", path: `/api/filters/${a.id}/tasks`, query: noId(a) }),
  }),
  tool({
    name: "list_folders",
    description: "List all folders in display order. A folder's context is work, personal or home.",
    access: "read",
    input: strict({}),
    request: () => ({ method: "GET", path: "/api/folders" }),
  }),
  tool({
    name: "list_lists",
    description: "List all lists in display order, with the folder each is in. Archived lists are included unless you set archived to false.",
    access: "read",
    input: strict({ archived: z.boolean().optional().describe("true for only archived lists, false for only active ones") }),
    request: (a) => ({ method: "GET", path: "/api/lists", query: a.archived === undefined ? {} : { archived: String(a.archived) } }),
  }),
  tool({
    name: "list_labels",
    description: "List all labels. Labels carry task state, such as next, wip, waitingOn and someday.",
    access: "read",
    input: strict({}),
    request: () => ({ method: "GET", path: "/api/labels" }),
  }),
  tool({
    name: "list_filters",
    description: "List saved filters (smart lists). Each has a query using the same parameters as search_tasks.",
    access: "read",
    input: strict({}),
    request: () => ({ method: "GET", path: "/api/filters" }),
  }),

  // ---- Tasks
  tool({
    name: "create_task",
    description:
      "Create a task, or a section heading with kind \"heading\". Set labels by name (missing ones are created). A task can nest under another task in the same list with parentId; headings cannot be nested." + CONVENTIONS,
    access: "write",
    input: withPlacement(taskCreateShape),
    request: (a) => ({ method: "POST", path: "/api/tasks", body: a }),
  }),
  tool({
    name: "update_task",
    description:
      "Change a task's title, notes, dates or recurrence, or replace its labels. Only the fields you send change; send null to clear a date or notes. labels replaces the whole set. To change which list or position it is in, use move_task." + CONVENTIONS,
    access: "write",
    input: z.object(taskFieldShapes).partial().extend({ id: id("task") }).strict(),
    request: (a) => ({ method: "PATCH", path: `/api/tasks/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "move_task",
    description:
      "Move a task to another list (listId), under another task (parentId, or null for top level), or to a position among its siblings (afterId or beforeId). Tasks nested under it move with it.",
    access: "write",
    input: withPlacement({ id: id("task"), listId: IdSchema.optional(), parentId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: `/api/tasks/${a.id}/move`, body: noId(a) }),
  }),
  tool({
    name: "complete_task",
    description: "Mark a task as done. Safe to repeat. Recurring tasks are not yet advanced to their next date.",
    access: "write",
    input: strict({ id: id("task") }),
    request: (a) => ({ method: "POST", path: `/api/tasks/${a.id}/complete` }),
  }),
  tool({
    name: "uncomplete_task",
    description: "Reopen a task that was marked done.",
    access: "write",
    input: strict({ id: id("task") }),
    request: (a) => ({ method: "POST", path: `/api/tasks/${a.id}/uncomplete` }),
  }),

  // ---- Lists and folders
  tool({
    name: "create_list",
    description: "Create a list, optionally inside a folder. It is added last among its siblings.",
    access: "write",
    input: strict({ name: z.string().min(1), folderId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: "/api/lists", body: a }),
  }),
  tool({
    name: "update_list",
    description: "Rename a list, or archive it (archived true) or restore it (archived false).",
    access: "write",
    input: strict({ id: id("list"), name: z.string().min(1).optional(), archived: z.boolean().optional() }),
    request: (a) => ({ method: "PATCH", path: `/api/lists/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "move_list",
    description: "Move a list to another folder (folderId, or null for no folder) and/or reorder it among its siblings.",
    access: "write",
    input: withPlacement({ id: id("list"), folderId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: `/api/lists/${a.id}/move`, body: noId(a) }),
  }),
  tool({
    name: "create_folder",
    description: "Create a folder with a context of work, personal or home. Optionally nest it in another folder.",
    access: "write",
    input: strict({ name: z.string().min(1), context: z.enum(CONTEXTS), parentId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: "/api/folders", body: a }),
  }),
  tool({
    name: "update_folder",
    description: "Rename a folder or change its context.",
    access: "write",
    input: strict({ id: id("folder"), name: z.string().min(1).optional(), context: z.enum(CONTEXTS).optional() }),
    request: (a) => ({ method: "PATCH", path: `/api/folders/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "move_folder",
    description: "Move a folder under another folder (parentId, or null for top level) and/or reorder it among its siblings.",
    access: "write",
    input: withPlacement({ id: id("folder"), parentId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: `/api/folders/${a.id}/move`, body: noId(a) }),
  }),

  // ---- Labels and filters
  tool({
    name: "create_label",
    description: "Create a label. Names are unique ignoring case. You rarely need this: create_task and update_task create missing labels.",
    access: "write",
    input: strict({ name: LabelNameSchema }),
    request: (a) => ({ method: "POST", path: "/api/labels", body: a }),
  }),
  tool({
    name: "rename_label",
    description: "Rename a label everywhere it is used.",
    access: "write",
    input: strict({ id: id("label"), name: LabelNameSchema }),
    request: (a) => ({ method: "PATCH", path: `/api/labels/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "create_filter",
    description:
      "Save a smart list. query is a query string using the same parameters as search_tasks, for example \"label=next&dueBefore=2026-11-01\".",
    access: "write",
    input: strict({ name: z.string().min(1), query: z.string() }),
    request: (a) => ({ method: "POST", path: "/api/filters", body: a }),
  }),
  tool({
    name: "update_filter",
    description: "Rename a saved filter or change its query.",
    access: "write",
    input: strict({ id: id("filter"), name: z.string().min(1).optional(), query: z.string().optional() }),
    request: (a) => ({ method: "PATCH", path: `/api/filters/${a.id}`, body: noId(a) }),
  }),
];
