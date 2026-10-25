# MCP Tools and Handler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Serve a remote MCP server at `/mcp` with 22 tools (read and write, no deletes), protected by the existing Claudia API tokens, so Claude Code can use it straight away.

**Architecture:** `createMcpHandler` (stateless Streamable HTTP, no Durable Object) mounted on the existing Hono app. Each tool turns its arguments into one request to the app itself, forwarding the caller's own bearer token. That means the API's validation, scope checks, event logging and ordering rules apply unchanged, and a `read` token sees only the read tools. Tool input schemas are built from the shared Zod 3 schemas, converted to JSON Schema with `zod-to-json-schema` and wrapped with the SDK's `fromJsonSchema()`.

**Tech Stack:** `agents@0.30.1`, `@modelcontextprotocol/server@2.3.1`, `zod-to-json-schema@3`, Hono, Vitest in workerd.

Design: `docs/plans/2026-10-25-remote-mcp-design.md`. This is step 1 of its "Order of work". OAuth and the consent page (step 2) are a separate plan.

---

## Verified facts (spiked 2026-10-25, in Node and in workerd)

- `@modelcontextprotocol/server` cannot convert Zod 3 schemas to JSON Schema: `tools/list` fails with "Schema appears to be from zod 3". Wrapping a JSON Schema with `fromJsonSchema()` works: `tools/list` returns the schema, a valid call succeeds, and an invalid one returns `isError: true` with "Input validation error: …".
- `agents@0.30.1` pins `@modelcontextprotocol/server` at exactly `2.3.1` and lists Zod 4 as a peer. The project stays on Zod 3, so installs need `legacy-peer-deps=true`.
- A stateless `tools/list` works without an `initialize` call first.
- Defaults in a Zod schema are not applied by the SDK. We parse each call's arguments with the Zod schema ourselves, which applies defaults and gives the same validation as the API.

## Decisions already made

- 22 tools, no deletes, nothing for tokens, settings or import (see the design doc).
- A token with only `read` scope gets only the 7 read tools.
- Tools call the app with header `X-Claudia-Client: mcp`, so events record actor `mcp`.
- `createMcpHandler` allows only the hostnames we serve (`claudia.alphajuliet.com` and `localhost`).

---

### Task 1: Install the packages

**Files:**
- Create: `.npmrc`
- Modify: `worker/package.json`, `package-lock.json` (via npm)

**Step 1:** Create `.npmrc` at the repo root:

```
legacy-peer-deps=true
```

(CI's `npm ci` reads this file too, which is why it is committed.)

**Step 2:** Install.

Run: `npm install -w @claudia/worker agents@0.30.1 @modelcontextprotocol/server@2.3.1 zod-to-json-schema@3`
Expected: three packages added to `worker/package.json` `dependencies`. `@modelcontextprotocol/server` must show exactly `2.3.1` (change `^2.3.1` to `2.3.1` by hand if npm wrote a caret, since `agents` pins it).

**Step 3:** Check the install is reproducible.

Run: `npm ci --dry-run`
Expected: no `ERESOLVE` error.

**Step 4:** Check nothing broke.

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing tests pass.

**Step 5: Commit**

```bash
git add .npmrc worker/package.json package-lock.json
git commit -m "Add MCP packages"
```

---

### Task 2: Make the shared schemas flat

The Move and Create schemas are built with `.and(PlacementSchema)`, which becomes `allOf` of two strict objects in JSON Schema and can never validate. Rebuild them as one object plus a refinement, and export the pieces the MCP tools need.

**Files:**
- Modify: `shared/src/schemas.ts`

**Step 1:** Run the existing tests first as a baseline.

Run: `npm test`
Expected: all pass. They are the safety net for this refactor; no new test is needed because behaviour must not change.

**Step 2:** In `shared/src/schemas.ts`, replace the placement definitions with these (keep the name `PlacementSchema`):

```ts
// Where to place an item among its siblings. Omit both to append.
export const placementShape = { afterId: IdSchema.optional(), beforeId: IdSchema.optional() };
const notBoth = (p: { afterId?: string | undefined; beforeId?: string | undefined }) => !(p.afterId && p.beforeId);
const NOT_BOTH = "Give afterId or beforeId, not both";
export const PlacementSchema = z.object(placementShape).refine(notBoth, NOT_BOTH);
```

Rewrite the four schemas that use `.and(PlacementSchema)` as one object with `...placementShape` spread in, followed by `.refine(notBoth, NOT_BOTH)`:

```ts
export const FolderMoveSchema = z
  .object({ parentId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("FolderMove");

export const ListMoveSchema = z
  .object({ folderId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("ListMove");

export const TaskMoveSchema = z
  .object({ listId: IdSchema.optional(), parentId: IdSchema.nullable().optional(), ...placementShape })
  .refine(notBoth, NOT_BOTH)
  .openapi("TaskMove");
```

`TaskFields` is currently a local `const`. Export it as `taskFieldShapes`, and add:

```ts
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
```

(`TaskUpdateSchema` stays `z.object(taskFieldShapes).partial()`, and `FilterMoveSchema` stays `PlacementSchema.openapi("FilterMove")`.)

**Step 3:** Run the suite again.

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass, unchanged. If a type error appears in a route handler, the handler was relying on the intersection type; give the `input` a `Placement`-compatible type rather than changing behaviour.

**Step 4: Commit**

```bash
git add shared
git commit -m "Flatten move and create schemas for JSON Schema conversion"
```

---

### Task 3: Look up a token without the middleware

**Files:**
- Modify: `worker/src/lib/auth.ts`

The MCP handler needs the token's scopes before it builds the tool list. Extract the lookup from `authenticate`.

**Step 1:** The existing `worker/test/auth.test.ts` already covers valid, revoked, expired and unknown tokens. Run it as the baseline.

Run: `cd worker && npx vitest run test/auth.test.ts`
Expected: pass.

**Step 2:** In `worker/src/lib/auth.ts`, add (above `authenticate`):

```ts
import type { Db } from "./db";

/** The live stored token for a bearer secret, or null. Notes use at most hourly. */
export async function lookupToken(db: Db, secret: string) {
  if (!secret.startsWith(PREFIX)) return null;
  const [row] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.hash, await hashToken(secret)), isNull(tokens.revokedAt)));
  if (!row || (row.expiresAt && row.expiresAt <= now())) return null;

  if (!row.lastUsedAt || Date.parse(row.lastUsedAt) < Date.now() - LAST_USED_GRANULARITY_MS) {
    await db.update(tokens).set({ lastUsedAt: now() }).where(eq(tokens.id, row.id));
  }
  return row;
}
```

Then replace the body of `authenticate` so it uses it:

```ts
export const authenticate = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = await lookupToken(c.var.db, secret);
  if (!row) throw new ApiError(401, "unauthorized", "Missing or invalid token");

  const needed = requiredScope(c.req.method, c.req.path);
  if (!allows(row.scopes as Scope[], needed)) {
    throw new ApiError(403, "forbidden", `This token needs the '${needed}' scope`);
  }

  // The caller says which client it is; this is audit information, not authorisation.
  const claimed = c.req.header("X-Claudia-Client") as Actor | undefined;
  c.set("actor", claimed && ACTORS.includes(claimed) && claimed !== "system" ? claimed : "cli");
  c.set("scopes", row.scopes as Scope[]);
  await next();
});
```

**Step 3:**

Run: `cd worker && npx tsc -p . && npx vitest run`
Expected: typecheck clean; every test passes (behaviour is identical).

**Step 4: Commit**

```bash
git add worker/src/lib/auth.ts
git commit -m "Extract token lookup from the auth middleware"
```

---

### Task 4: Tool definitions

**Files:**
- Create: `worker/src/mcp/tools.ts`
- Test: `worker/test/mcp-tools.test.ts`

Each tool is data: a name, a description, an access level, an input schema and a function that turns validated arguments into one API request.

**Step 1: Write the failing test**

```ts
// worker/test/mcp-tools.test.ts
import { describe, expect, it } from "vitest";
import { TOOLS, type ToolDef } from "../src/mcp/tools";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID2 = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const tool = (name: string): ToolDef => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const req = (name: string, args: object) => {
  const t = tool(name);
  return t.request(t.input.parse(args));
};

describe("tool list", () => {
  it("has the 22 expected tools and no deletes or admin tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "complete_task", "create_folder", "create_filter", "create_label", "create_list", "create_task",
      "get_task", "list_filters", "list_folders", "list_labels", "list_lists", "move_folder", "move_list",
      "move_task", "rename_label", "run_filter", "search_tasks", "uncomplete_task", "update_filter",
      "update_folder", "update_list", "update_task",
    ].sort());
    for (const t of TOOLS) expect(t.name).not.toMatch(/delete|remove|token|import|setting/);
  });

  it("marks exactly the 7 read tools as read", () => {
    expect(TOOLS.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "get_task", "list_filters", "list_folders", "list_labels", "list_lists", "run_filter", "search_tasks",
    ]);
  });

  it("gives every tool a description and a unique name", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });
});

describe("request mapping", () => {
  it("search_tasks applies the default limit and passes filters as a query", () => {
    expect(req("search_tasks", {})).toEqual({ method: "GET", path: "/api/tasks", query: { status: "open", limit: 50, offset: 0 } });
    expect(req("search_tasks", { label: "next", dueBefore: "2026-11-01", limit: 10 }).query).toMatchObject({
      label: "next", dueBefore: "2026-11-01", limit: 10,
    });
  });

  it("reads use GET and the id in the path", () => {
    expect(req("get_task", { id: ID })).toEqual({ method: "GET", path: `/api/tasks/${ID}` });
    expect(req("run_filter", { id: ID, limit: 5 })).toEqual({ method: "GET", path: `/api/filters/${ID}/tasks`, query: { limit: 5 } });
    expect(req("list_lists", { archived: true }).query).toEqual({ archived: "true" });
    expect(req("list_folders", {})).toEqual({ method: "GET", path: "/api/folders" });
  });

  it("create_task posts every field it was given, including placement", () => {
    expect(req("create_task", { listId: ID, title: "T", labels: ["next"], afterId: ID2 })).toEqual({
      method: "POST", path: "/api/tasks", body: { listId: ID, title: "T", labels: ["next"], afterId: ID2 },
    });
  });

  it("update and move take the id from the path, not the body", () => {
    expect(req("update_task", { id: ID, title: "New", dueDate: null })).toEqual({
      method: "PATCH", path: `/api/tasks/${ID}`, body: { title: "New", dueDate: null },
    });
    expect(req("move_task", { id: ID, listId: ID2 })).toEqual({ method: "POST", path: `/api/tasks/${ID}/move`, body: { listId: ID2 } });
    expect(req("move_list", { id: ID, folderId: null })).toEqual({ method: "POST", path: `/api/lists/${ID}/move`, body: { folderId: null } });
    expect(req("update_list", { id: ID, archived: true })).toEqual({ method: "PATCH", path: `/api/lists/${ID}`, body: { archived: true } });
    expect(req("rename_label", { id: ID, name: "doing" })).toEqual({ method: "PATCH", path: `/api/labels/${ID}`, body: { name: "doing" } });
  });

  it("complete and uncomplete post with no body", () => {
    expect(req("complete_task", { id: ID })).toEqual({ method: "POST", path: `/api/tasks/${ID}/complete` });
    expect(req("uncomplete_task", { id: ID })).toEqual({ method: "POST", path: `/api/tasks/${ID}/uncomplete` });
  });

  it("creates folders, lists, labels and filters", () => {
    expect(req("create_folder", { name: "F", context: "home" }).body).toEqual({ name: "F", context: "home" });
    expect(req("create_list", { name: "L", folderId: ID }).body).toEqual({ name: "L", folderId: ID });
    expect(req("create_label", { name: "next" })).toEqual({ method: "POST", path: "/api/labels", body: { name: "next" } });
    expect(req("create_filter", { name: "Soon", query: "dueBefore=2026-11-01" }).path).toBe("/api/filters");
    expect(req("update_filter", { id: ID, query: "label=next" })).toEqual({ method: "PATCH", path: `/api/filters/${ID}`, body: { query: "label=next" } });
  });
});

describe("input validation", () => {
  it("rejects bad ids, dates and unknown fields", () => {
    expect(() => req("get_task", { id: "nope" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "T", dueDate: "tomorrow" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "T", surprise: 1 })).toThrow();
    expect(() => req("move_task", { id: ID, afterId: ID, beforeId: ID2 })).toThrow();
  });
});
```

**Step 2: Run it to see it fail**

Run: `cd worker && npx vitest run test/mcp-tools.test.ts`
Expected: FAIL, "Failed to resolve import ../src/mcp/tools".

**Step 3: Implement**

```ts
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

```

(The date rules come from `taskFieldShapes` and `TaskQuerySchema`, so nothing else needs importing.)

**Step 4: Run to see it pass**

Run: `cd worker && npx tsc -p . && npx vitest run test/mcp-tools.test.ts`
Expected: PASS. Fix any expectation that is wrong about the exact request shape rather than loosening the assertion: for example, `search_tasks` with no arguments must give `status: "open", limit: 50, offset: 0` from the schema defaults.

**Step 5: Commit**

```bash
git add worker/src/mcp/tools.ts worker/test/mcp-tools.test.ts
git commit -m "Define the MCP tools"
```

---

### Task 5: The MCP server and handler

**Files:**
- Create: `worker/src/mcp/server.ts`
- Create: `worker/src/mcp/handler.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.jsonc`
- Test: `worker/test/mcp.test.ts`

**Step 1: Write the failing test**

```ts
// worker/test/mcp.test.ts
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src";
import { events } from "../src/db/schema";
import { db, makeToken, reset } from "./helpers";

const URL_ = "https://claudia.alphajuliet.com/mcp";
// Hono's app.request has no execution context unless given one.
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
let rpcId = 0;

async function rpc(token: string | null, method: string, params?: unknown) {
  const res = await app.request(
    URL_,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    },
    env,
    ctx,
  );
  const text = await res.text();
  const data = /^data: (.*)$/m.exec(text)?.[1];
  return { status: res.status, headers: res.headers, json: data ? JSON.parse(data) : text ? JSON.parse(text) : null };
}

const listTools = async (token: string) => (await rpc(token, "tools/list")).json.result.tools as { name: string; inputSchema: any; annotations: any }[];

async function call(token: string, name: string, args: object = {}) {
  const { json } = await rpc(token, "tools/call", { name, arguments: args });
  const text = json.result.content[0].text as string;
  return { isError: Boolean(json.result.isError), text, data: json.result.isError ? undefined : text === "Done" ? undefined : JSON.parse(text) };
}

let write: string;
beforeEach(async () => {
  await reset();
  write = await makeToken(["write"]);
});

describe("authentication", () => {
  it("refuses a missing, malformed or unknown token with a Bearer challenge", async () => {
    for (const t of [null, "nope", "cl_unknown"]) {
      const res = await rpc(t, "tools/list");
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
  });

  it("refuses a revoked token", async () => {
    const revoked = await makeToken(["write"], { revokedAt: "2026-01-01T00:00:00.000Z" });
    expect((await rpc(revoked, "tools/list")).status).toBe(401);
  });
});

describe("tools/list", () => {
  it("gives a write token all 22 tools, with JSON Schemas and hints", async () => {
    const tools = await listTools(write);
    expect(tools).toHaveLength(22);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations.destructiveHint).toBe(false);
    }
    const create = tools.find((t) => t.name === "create_task")!;
    expect(Object.keys(create.inputSchema.properties)).toEqual(expect.arrayContaining(["listId", "title", "labels", "dueDate", "afterId"]));
    expect(create.inputSchema.required).toEqual(expect.arrayContaining(["listId", "title"]));
    expect(create.inputSchema.allOf).toBeUndefined();
  });

  it("gives a read token only the 7 read tools, marked read-only", async () => {
    const tools = await listTools(await makeToken(["read"]));
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_task", "list_filters", "list_folders", "list_labels", "list_lists", "run_filter", "search_tasks",
    ]);
    expect(tools.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
  });

  it("never offers deletes, tokens, settings or import, even to an admin", async () => {
    const names = (await listTools(await makeToken(["admin"]))).map((t) => t.name);
    expect(names.filter((n) => /delete|token|setting|import/.test(n))).toEqual([]);
  });
});

describe("working through the tools", () => {
  it("plans a small project end to end", async () => {
    const folder = (await call(write, "create_folder", { name: "Home", context: "home" })).data;
    const list = (await call(write, "create_list", { name: "Renovations", folderId: folder.id })).data;
    const a = (await call(write, "create_task", { listId: list.id, title: "Paint", labels: ["next"], dueDate: "2026-11-05" })).data;
    const b = (await call(write, "create_task", { listId: list.id, title: "Plaster", beforeId: a.id })).data;
    const sub = (await call(write, "create_task", { listId: list.id, title: "Buy paint", parentId: a.id })).data;
    expect(sub.parentId).toBe(a.id);

    const titles = (await call(write, "search_tasks", { listId: list.id })).data.map((t: any) => t.title);
    expect([...titles].sort()).toEqual(["Buy paint", "Paint", "Plaster"]);
    expect(b.position < a.position).toBe(true); // placed before Paint
    expect((await call(write, "search_tasks", { label: "next" })).data.map((t: any) => t.title)).toEqual(["Paint"]);

    const updated = (await call(write, "update_task", { id: b.id, title: "Plaster walls", notes: "Two coats", labels: ["wip"] })).data;
    expect(updated).toMatchObject({ title: "Plaster walls", notes: "Two coats", labels: ["wip"] });

    const moved = (await call(write, "move_task", { id: b.id, afterId: a.id })).data;
    expect(moved.position > a.position).toBe(true); // now after Paint

    expect((await call(write, "complete_task", { id: a.id })).data.completedAt).not.toBeNull();
    expect((await call(write, "search_tasks", { status: "completed" })).data.map((t: any) => t.title)).toEqual(["Paint"]);
    expect((await call(write, "uncomplete_task", { id: a.id })).data.completedAt).toBeNull();

    const filter = (await call(write, "create_filter", { name: "Next", query: "label=next" })).data;
    expect((await call(write, "run_filter", { id: filter.id })).data.map((t: any) => t.title)).toEqual(["Paint"]);
    expect((await call(write, "list_filters")).data).toHaveLength(1);

    await call(write, "update_list", { id: list.id, archived: true });
    expect((await call(write, "list_lists", { archived: true })).data).toHaveLength(1);
    expect((await call(write, "list_folders")).data.map((f: any) => f.name)).toEqual(["Home"]);
    expect((await call(write, "list_labels")).data.map((l: any) => l.name)).toEqual(["next", "wip"]);
    expect((await call(write, "get_task", { id: a.id })).data.title).toBe("Paint");
  });

  it("applies the default limit of 50", async () => {
    const list = (await call(write, "create_list", { name: "Many" })).data;
    for (let i = 0; i < 55; i++) await call(write, "create_task", { listId: list.id, title: `T${i}` });
    expect((await call(write, "search_tasks", {})).data).toHaveLength(50);
    expect((await call(write, "search_tasks", { offset: 50 })).data).toHaveLength(5);
  });
});

describe("errors", () => {
  it("turns API errors into tool errors Claude can read", async () => {
    const list = (await call(write, "create_list", { name: "L" })).data;
    const parent = (await call(write, "create_task", { listId: list.id, title: "P" })).data;
    const child = (await call(write, "create_task", { listId: list.id, title: "C", parentId: parent.id })).data;
    const res = await call(write, "move_task", { id: parent.id, parentId: child.id });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/inside itself/);
  });

  it("turns bad arguments into tool errors, not crashes", async () => {
    const res = await call(write, "create_task", { listId: "nope", title: "" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/validation|invalid/i);
  });

  it("reports not found plainly", async () => {
    const res = await call(write, "get_task", { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(res).toMatchObject({ isError: true });
    expect(res.text).toMatch(/not found/i);
  });
});

describe("audit trail and scope", () => {
  it("logs changes with actor mcp", async () => {
    const list = (await call(write, "create_list", { name: "L" })).data;
    const t = (await call(write, "create_task", { listId: list.id, title: "T" })).data;
    const [row] = await db.select().from(events).where(eq(events.entityId, t.id));
    expect(row).toMatchObject({ type: "created", actor: "mcp" });
  });

  it("enforces the token's scope even if a write tool is called by name", async () => {
    const read = await makeToken(["read"]);
    const res = await rpc(read, "tools/call", { name: "create_list", arguments: { name: "Sneaky" } });
    expect(JSON.stringify(res.json)).toMatch(/not found|unknown|error/i);
    expect((await db.query.lists.findMany()).length).toBe(0);
  });
});
```

**Step 2: Run to see it fail**

Run: `cd worker && npx vitest run test/mcp.test.ts`
Expected: FAIL (`/mcp` is not routed, so requests return 404 or the SPA page).

**Step 3: Implement the server**

```ts
// worker/src/mcp/server.ts
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Scope } from "../lib/router";
import { TOOLS, type ApiRequest, type ToolDef } from "./tools";

export type CallApi = (req: ApiRequest) => Promise<{ ok: boolean; status: number; json: any }>;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

/** What Claude sees when the API refuses: the message, plus the first few validation issues. */
function describeError(status: number, json: any): string {
  const err = json?.error;
  if (!err) return `The request failed (${status}).`;
  const issues = Array.isArray(err.issues) && err.issues.length ? ` Details: ${JSON.stringify(err.issues.slice(0, 5))}` : "";
  return `${err.message} (${err.code})${issues}`;
}

export function jsonSchemaOf(tool: ToolDef): Record<string, unknown> {
  const schema = zodToJsonSchema(tool.input, { target: "jsonSchema2019-09", $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** The tools this token may use: read tools always, write tools only with write or admin scope. */
export const toolsFor = (scopes: readonly Scope[]) =>
  TOOLS.filter((t) => t.access === "read" || scopes.includes("write") || scopes.includes("admin"));

export function buildServer(scopes: readonly Scope[], callApi: CallApi) {
  const server = new McpServer({ name: "claudia", version: "0.1.0" });
  for (const tool of toolsFor(scopes)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(jsonSchemaOf(tool)),
        annotations: { readOnlyHint: tool.access === "read", destructiveHint: false, openWorldHint: false },
      },
      async (raw: unknown) => {
        // Our own parse applies defaults and gives the same rules as the API.
        const parsed = tool.input.safeParse(raw);
        if (!parsed.success) return text(`Invalid arguments: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`, true);
        const res = await callApi(tool.request(parsed.data));
        if (!res.ok) return text(describeError(res.status, res.json), true);
        return text(res.json === undefined ? "Done" : JSON.stringify(res.json));
      },
    );
  }
  return server;
}
```

**Step 4: Implement the handler**

```ts
// worker/src/mcp/handler.ts
import { createMcpHandler } from "agents/mcp/server";
import { lookupToken } from "../lib/auth";
import { createDb } from "../lib/db";
import type { Scope } from "../lib/router";
import { buildServer, type CallApi } from "./server";

const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: "unauthorized", message: "Missing or invalid token" } }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="claudia"' },
  });

/**
 * Serve MCP for a caller holding a Claudia API token. Tools call the app
 * itself with that same token, so the API's rules and scopes apply unchanged.
 */
export async function handleMcp(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  app: { fetch: (req: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Response | Promise<Response> },
): Promise<Response> {
  const header = request.headers.get("Authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = await lookupToken(createDb(env.DB), secret);
  if (!row) return unauthorized();

  const origin = new URL(request.url).origin;
  const callApi: CallApi = async ({ method, path, query, body }) => {
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const res = await app.fetch(
      new Request(url, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "X-Claudia-Client": "mcp",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    );
    const raw = await res.text();
    return { ok: res.ok, status: res.status, json: raw ? JSON.parse(raw) : undefined };
  };

  return createMcpHandler(() => buildServer(row.scopes as Scope[], callApi), {
    route: "/mcp",
    allowedHostnames: ["claudia.alphajuliet.com", "localhost"],
  })(request, env, ctx);
}
```

**Step 5: Mount it and let it through the asset layer**

In `worker/src/index.ts`, add `import { handleMcp } from "./mcp/handler";` and, after the `/api` middleware and before `app.route(...)` lines:

```ts
// MCP has its own token check (it needs the token's scopes to build the tool list).
app.all("/mcp", (c) => handleMcp(c.req.raw, c.env, c.executionCtx, app));
```

In `worker/wrangler.jsonc`, change `run_worker_first` to include the bare path (the pattern `/mcp/*` does not match `/mcp`):

```jsonc
		"run_worker_first": [
			"/api/*",
			"/mcp",
			"/mcp/*"
		]
```

**Step 6: Run everything**

Run: `cd worker && npx tsc -p . && npx vitest run`
Expected: typecheck clean; all tests pass, including `mcp.test.ts`.

If `tools/list` returns an error about Zod, a tool's schema has a type `zod-to-json-schema` cannot express: print `jsonSchemaOf(tool)` for that tool and simplify it (for example avoid `.transform()` and `.refine()` on the inner object; `withPlacement` is a refinement on the whole object, which converts to the inner object's schema and is checked again by our own `safeParse`).

If the test for "enforces the token's scope" fails because the SDK returns something else for an unregistered tool, adjust the assertion to match the SDK's actual error but keep the second assertion: the list table must stay empty.

**Step 7: Commit**

```bash
git add worker
git commit -m "Serve MCP tools at /mcp"
```

---

### Task 6: Size, docs and deploy

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Check the Worker still fits.**

Run: `cd worker && npx wrangler deploy --dry-run --outdir /tmp/claudia-dry 2>&1 | grep -E "Total Upload|gzip|ERROR"`
Expected: a total upload with gzip size well under 3 MiB (the Free plan limit is 3 MiB gzipped, paid is 10 MiB). If it is over, report the size and stop; do not deploy.

**Step 2: Docs.** In `CLAUDE.md` under Commands, add:

```
- Remote MCP: `https://claudia.alphajuliet.com/mcp`, authenticated with a Claudia API token (a `read` token sees only the read tools). Add it to Claude Code with:
  `claude mcp add --transport http claudia https://claudia.alphajuliet.com/mcp --header "Authorization: Bearer $(cat ~/.config/claudia/write-token)"`
```

**Step 3:** Full checks.

Run: `npm run typecheck && npm test && npm run build`
Expected: all succeed.

**Step 4: Commit and push** (CI deploys).

```bash
git add CLAUDE.md
git commit -m "Document the MCP endpoint"
git push
```

Then watch the Deploy workflow until it passes.

---

### Task 7: Try it for real (Andrew)

**Step 1:** Add the server to Claude Code (the command in Task 6, run in your terminal).

**Step 2:** Start a Claude Code session and ask: "List my Claudia folders", then "Show my next actions" (this should call `search_tasks` with `label=next`), then create, move and complete a test task. Expect each to take effect, and expect no delete tool to be offered.

**Step 3:** Check the history shows the actor as `mcp`:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.config/claudia/admin-token)" "https://claudia.alphajuliet.com/api/tasks?status=all&limit=5" | jq '.[0].title'
```

**Step 4: Board.** If it all works, move "Serve remote MCP with update and move" to DONE and add a NEXT card: "Connect claude.ai and phone to MCP with OAuth and a passphrase consent page" (design step 2; it needs a KV namespace and an `OWNER_PASSPHRASE` secret from you).

---

## Risks and how this plan handles them

- **Zod 3 and the SDK.** Verified by spike; Task 5 has a fallback instruction if one tool's schema doesn't convert.
- **Peer-dependency conflicts breaking CI.** `.npmrc` is committed and Task 1 runs `npm ci --dry-run`.
- **Bundle size.** Checked before deploying (Task 6, Step 1).
- **Wrong `/mcp` routing.** `run_worker_first` gets the bare `/mcp` path, and a test hits the route.
- **A write tool reached with a read token.** The tool isn't registered for that token, and the API would refuse anyway because the token is forwarded.
- **Claude doing something destructive.** There are no delete tools. Moves and updates are logged with before and after, so they are recoverable by hand.
