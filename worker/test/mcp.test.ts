// worker/test/mcp.test.ts
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { provider } from "../src";
import { events } from "../src/db/schema";
import { db, makeToken, reset } from "./helpers";

const URL_ = "https://claudia.alphajuliet.com/mcp";
// Hono's app.request has no execution context unless given one.
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
let rpcId = 0;

async function rpc(token: string | null, method: string, params?: unknown, host = "claudia.alphajuliet.com") {
  const res = await provider.fetch(
    new Request(URL_, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Real requests carry Host; app.request does not, and the SDK checks it.
        Host: host,
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
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
  it("refuses a missing, malformed or unknown token with the provider's Bearer challenge", async () => {
    for (const t of [null, "nope", "cl_unknown"]) {
      const res = await rpc(t, "tools/list");
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
      expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
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
    expect(res.json.error).toEqual({ code: -32602, message: "Tool create_list not found" });
    expect(res.json.result).toBeUndefined();
    expect((await db.query.lists.findMany()).length).toBe(0);
  });
});

describe("host checks", () => {
  it("rejects a request for another host", async () => {
    const res = await rpc(write, "tools/list", undefined, "evil.example");
    expect(res.status).toBe(403);
  });

  it("accepts the allowed hosts, with or without a port", async () => {
    for (const host of ["claudia.alphajuliet.com", "localhost:8787", "127.0.0.1:8787"]) {
      expect((await rpc(write, "tools/list", undefined, host)).status).toBe(200);
    }
  });
});
