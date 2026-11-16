// worker/src/mcp/tools.ts
import {
  CONTEXTS,
  IdSchema,
  LABEL_COLOURS,
  LabelColourSchema,
  LabelNameSchema,
  VIEW_IDS,
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
  " Dates are YYYY-MM-DD. Status labels hold state (for example next, wip, waitingOn, someday): a task has one at most, and a new one replaces the old. IDs are ULIDs taken from earlier results.";

/** The search language, for search_tasks, create_filter and update_filter. */
const LANGUAGE =
  "The search language: words match title or notes; #name or label:name; list:, folder: (with subfolders), context:, " +
  "priority: (low < normal < high); due:, start:, snoozed:, completed:, created:, updated: with today, tomorrow, yesterday, 7d, 2w, 3m, today-7d " +
  "or YYYY-MM-DD and :<, :<=, :>, :>=; is: (open, completed, snoozed, available, recurring, heading, subtask, inbox); has: (due, start, notes, labels, status, parent); " +
  "AND, OR, NOT, -term, parentheses (a space means AND). Names ignore case and a leading emoji, and take * as a wildcard; quote names with spaces (list:\"Home admin\"). " +
  "Open, unsnoozed tasks (not headings) unless it says otherwise. " +
  "For example: \"#next is:available\", \"folder:Work (#wip OR due:<=today)\", \"completed:>=today-7d\", \"list:Garden -has:due\". " +
  "sort: due, start, priority, created, updated, title or list, with -desc for reverse (due-desc). group: list, due, label, status, none, or label:wip,next for a label order.";
const SORT = z.string().optional().describe("Overrides sort: in the query, e.g. due or due-desc");
const GROUP = z.string().optional().describe("Overrides group: in the query, e.g. status or label:wip,next");

export const TOOLS: ToolDef[] = [
  // ---- Read
  tool({
    name: "search_tasks",
    description:
      "Find tasks with a query in the search language, as the app's Search screen does. Returns { tasks, sort, group }: up to 50 tasks at a time " +
      "(use offset to page), sorted, with the sort and grouping in effect. An empty query gives every open task. A query that can't be read is an error " +
      "naming the column. " + LANGUAGE + CONVENTIONS,
    access: "read",
    input: strict({
      query: z.string().default("").describe("The search, e.g. \"folder:Work #next\""),
      context: z.enum(["all", ...CONTEXTS]).optional().describe("Narrow to one context's lists, unless the query names context: or folder:"),
      status: z.enum(["open", "completed", "all"]).optional().describe("Overrides which tasks by completion; without it, open ones unless the query mentions is:completed, is:open or completed:"),
      sort: SORT,
      group: GROUP,
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    request: ({ query, ...rest }) => ({ method: "GET", path: "/api/search", query: { q: query, ...rest } }),
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
    description: "Run a saved filter (smart view) and return its matching tasks, sorted, with the sort and grouping in effect.",
    access: "read",
    input: strict({
      id: id("filter"),
      context: z.enum(["all", ...CONTEXTS]).optional().describe("Narrow to one context's lists, unless the filter's query names context: or folder:"),
      status: z.enum(["open", "completed", "all"]).optional().describe("Overrides the query's own status, e.g. completed for its done tasks"),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    request: (a) => ({ method: "GET", path: `/api/filters/${a.id}/tasks`, query: noId(a) }),
  }),
  tool({
    name: "list_views",
    description:
      "List the built-in views (inbox, today, next, wip, waiting, someday) with the search query each one is and how many open tasks it shows, optionally in one context (work, personal or home). Use get_view for their tasks.",
    access: "read",
    input: strict({ context: z.enum(["all", ...CONTEXTS]).optional().describe("Narrow to one context; all by default") }),
    request: (a) => ({ method: "GET", path: "/api/views", query: { ...a } }),
  }),
  tool({
    name: "get_view",
    description:
      "Get a built-in view's tasks, exactly as the app shows them: open, unsnoozed tasks (not headings). inbox: the Inbox list. today: due or started today or earlier (the user's day). next, wip, waiting, someday: tasks with the label next, wip, waitingOn or someday. Each view is a search query (list_views gives it), so it can be narrowed in search, e.g. \"#next folder:Work\". Prefer this over search_tasks for these.",
    access: "read",
    input: strict({
      id: z.enum(VIEW_IDS).describe("Which view"),
      context: z.enum(["all", ...CONTEXTS]).optional().describe("Narrow to one context's lists (the Inbox and lists in no folder show in all)"),
      status: z.enum(["open", "completed"]).optional().describe("completed: its completed tasks instead (today: completed today)"),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    request: (a) => ({ method: "GET", path: `/api/views/${a.id}/tasks`, query: noId(a) }),
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
    description: "List all labels. Status labels (status true, ordered by statusPosition), such as next, wip, waitingOn and someday, carry task state: a task has one at most, and giving a task a new one replaces the old.",
    access: "read",
    input: strict({}),
    request: () => ({ method: "GET", path: "/api/labels" }),
  }),
  tool({
    name: "list_filters",
    description: "List saved filters (smart views): each has a query in the search language (see create_filter), a sort, a grouping (null for the defaults) and the folder it sits in.",
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
      "Change a task's title, notes, dates, recurrence or priority, or replace its labels. Only the fields you send change; send null to clear a date or notes. labels replaces the whole set. To change which list or position it is in, use move_task." + CONVENTIONS,
    access: "write",
    input: z.object(taskFieldShapes).partial().extend({ id: id("task") }).strict(),
    request: (a) => ({ method: "PATCH", path: `/api/tasks/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "move_task",
    description:
      "Move a task to another list (listId), under another task (parentId, or null for top level), or to a position among its siblings (afterId or beforeId, or atStart for first). Without a position it goes last; the app puts a task moved to another list first, so send atStart: true for that unless asked otherwise. Tasks nested under it move with it. With withSection, a heading takes the tasks under it along, in order; it can't be placed inside its own section.",
    access: "write",
    input: withPlacement({
      id: id("task"),
      listId: IdSchema.optional(),
      parentId: IdSchema.nullable().optional(),
      withSection: z.boolean().optional().describe("For a heading: move the tasks under it (down to the next heading) with it"),
      atStart: z.boolean().optional().describe("Place first among its new siblings (ignored with afterId or beforeId)"),
    }),
    request: (a) => ({ method: "POST", path: `/api/tasks/${a.id}/move`, body: noId(a) }),
  }),
  tool({
    name: "complete_task",
    description: "Mark a task as done, with its open subtasks at every level. A repeating task moves to its next due date and stays open, leaving its subtasks alone. Safe to repeat for other tasks.",
    access: "write",
    input: strict({ id: id("task") }),
    request: (a) => ({ method: "POST", path: `/api/tasks/${a.id}/complete` }),
  }),
  tool({
    name: "uncomplete_task",
    description: "Reopen a task that was marked done. Subtasks completed with it reopen too.",
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
    description: "Create a folder. A top-level folder needs a context of work, personal or home; one nested in another folder (parentId) takes that folder's context.",
    access: "write",
    input: strict({ name: z.string().min(1), context: z.enum(CONTEXTS).optional(), parentId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: "/api/folders", body: a }),
  }),
  tool({
    name: "update_folder",
    description: "Rename a folder or change its context (the folders under it change too).",
    access: "write",
    input: strict({ id: id("folder"), name: z.string().min(1).optional(), context: z.enum(CONTEXTS).optional() }),
    request: (a) => ({ method: "PATCH", path: `/api/folders/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "move_folder",
    description: "Move a folder under another folder (parentId, or null for top level) and/or reorder it among its siblings. Under another folder it takes that folder's context, as do the folders under it.",
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
    name: "update_label",
    description: `Rename a label everywhere it is used, set its colour (one of ${LABEL_COLOURS.join(", ")}, or null for the default grey), and/or make it a status label or not.`,
    access: "write",
    input: strict({
      id: id("label"),
      name: LabelNameSchema.optional(),
      color: LabelColourSchema.optional(),
      status: z.boolean().optional().describe("true: a status label (a task has one at most), added last among them; false: an ordinary label"),
    }),
    request: (a) => ({ method: "PATCH", path: `/api/labels/${a.id}`, body: noId(a) }),
  }),
  tool({
    name: "create_filter",
    description:
      "Save a smart view. query is in the search language (sort: and group: at its top level are saved as its sort and grouping). " + LANGUAGE,
    access: "write",
    input: strict({
      name: z.string().min(1),
      query: z.string(),
      sort: z.string().nullable().optional(),
      group: z.string().nullable().optional(),
      showCompleted: z.boolean().optional().describe("Show completed tasks when it opens in the app"),
      folderId: IdSchema.nullable().optional().describe("The folder to keep it in; none by default"),
    }),
    request: ({ showCompleted, ...a }) => ({ method: "POST", path: "/api/filters", body: { ...a, ...(showCompleted === undefined ? {} : { display: { showCompleted } }) } }),
  }),
  tool({
    name: "update_filter",
    description: "Rename a saved filter, or change its query, sort, grouping (null for the default) or whether it shows completed tasks. The query is as for create_filter.",
    access: "write",
    input: strict({
      id: id("filter"),
      name: z.string().min(1).optional(),
      query: z.string().optional(),
      sort: z.string().nullable().optional(),
      group: z.string().nullable().optional(),
      showCompleted: z.boolean().optional(),
    }),
    request: ({ showCompleted, ...a }) => ({
      method: "PATCH",
      path: `/api/filters/${a.id}`,
      body: { ...noId(a), ...(showCompleted === undefined ? {} : { display: { showCompleted } }) },
    }),
  }),
  tool({
    name: "move_filter",
    description: "Move a saved filter to a folder (folderId, or null for none) and/or reorder it among the filters there.",
    access: "write",
    input: withPlacement({ id: id("filter"), folderId: IdSchema.nullable().optional() }),
    request: (a) => ({ method: "POST", path: `/api/filters/${a.id}/move`, body: noId(a) }),
  }),
];
