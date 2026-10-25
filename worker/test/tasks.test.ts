import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let inbox: { id: string };
let other: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "shortcut" });
  inbox = (await api("POST", "/api/lists", { name: "Inbox" })).body;
  other = (await api("POST", "/api/lists", { name: "Other" })).body;
});

const task = async (title: string, extra: object = {}) =>
  (await api("POST", "/api/tasks", { listId: inbox.id, title, ...extra })).body;
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
const query = async (qs = "") => titles((await api("GET", `/api/tasks${qs}`)).body);

describe("create and read", () => {
  it("creates with defaults and reads back", async () => {
    const t = await task("Write tests");
    expect(t).toMatchObject({
      title: "Write tests", kind: "task", parentId: null, notes: null, dueDate: null,
      recurRule: null, completedAt: null, labels: [], metadata: null,
    });
    expect(t.deletedAt).toBeUndefined();
    expect((await api("GET", `/api/tasks/${t.id}`)).body).toEqual(t);
  });

  it("stores dates, notes, metadata and recurrence", async () => {
    const t = await task("Bins", {
      notes: "Yellow lid", dueDate: "2026-11-02", startDate: "2026-11-01",
      recurRule: "FREQ=WEEKLY", recurFrom: "due", metadata: { source: "godspeed" },
    });
    expect(t).toMatchObject({ dueDate: "2026-11-02", recurRule: "FREQ=WEEKLY", recurFrom: "due", metadata: { source: "godspeed" } });
  });

  it("validates input", async () => {
    expect((await api("POST", "/api/tasks", { listId: inbox.id, title: "" })).status).toBe(400);
    expect((await api("POST", "/api/tasks", { listId: inbox.id, title: "x", dueDate: "tomorrow" })).status).toBe(400);
    expect((await api("POST", "/api/tasks", { listId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "x" })).status).toBe(404);
    const lone = await api("POST", "/api/tasks", { listId: inbox.id, title: "x", recurRule: "FREQ=DAILY" });
    expect(lone).toMatchObject({ status: 422, body: { error: { code: "invalid_recurrence" } } });
  });

  it("appends in order and places before/after", async () => {
    const a = await task("A");
    const b = await task("B");
    await task("C", { beforeId: b.id });
    await task("D", { afterId: a.id });
    expect(await query(`?listId=${inbox.id}`)).toEqual(["A", "D", "C", "B"]);
  });
});

describe("update", () => {
  it("changes only the fields sent and clears with null", async () => {
    const t = await task("Old", { notes: "n", dueDate: "2026-11-02" });
    const res = await api("PATCH", `/api/tasks/${t.id}`, { title: "New", dueDate: null });
    expect(res.body).toMatchObject({ title: "New", notes: "n", dueDate: null });
    expect(res.body.updatedAt >= t.updatedAt).toBe(true);
  });

  it("rejects half-setting recurrence but allows clearing both", async () => {
    const t = await task("R", { recurRule: "FREQ=DAILY", recurFrom: "due" });
    expect((await api("PATCH", `/api/tasks/${t.id}`, { recurFrom: null })).status).toBe(422);
    const cleared = await api("PATCH", `/api/tasks/${t.id}`, { recurRule: null, recurFrom: null });
    expect(cleared.body).toMatchObject({ recurRule: null, recurFrom: null });
  });
});

describe("labels", () => {
  it("creates missing labels, reuses existing ones case-insensitively and replaces the set", async () => {
    const t = await task("T", { labels: ["wip", "Next"] });
    expect(t.labels).toEqual(["Next", "wip"]);
    const all = (await api("GET", "/api/labels")).body;
    expect(all.map((l: { name: string }) => l.name)).toEqual(["Next", "wip"]);

    const again = await api("PATCH", `/api/tasks/${t.id}`, { labels: ["NEXT", "someday"] });
    expect(again.body.labels).toEqual(["Next", "someday"]);
    expect((await api("GET", "/api/labels")).body).toHaveLength(3);
    expect((await api("PATCH", `/api/tasks/${t.id}`, { labels: [] })).body.labels).toEqual([]);
  });

  it("filters tasks by label", async () => {
    await task("A", { labels: ["next"] });
    await task("B", { labels: ["wip"] });
    await task("C");
    expect(await query("?label=NEXT")).toEqual(["A"]);
  });

  it("renames, and deleting removes it from tasks", async () => {
    const t = await task("T", { labels: ["wip"] });
    const [label] = (await api("GET", "/api/labels")).body;
    expect((await api("PATCH", `/api/labels/${label.id}`, { name: "doing" })).body.name).toBe("doing");
    expect((await api("GET", `/api/tasks/${t.id}`)).body.labels).toEqual(["doing"]);
    expect((await api("POST", "/api/labels", { name: "DOING" })).status).toBe(409);

    expect((await api("DELETE", `/api/labels/${label.id}`)).status).toBe(204);
    expect((await api("GET", `/api/tasks/${t.id}`)).body.labels).toEqual([]);
    // The name is free again.
    expect((await api("POST", "/api/labels", { name: "doing" })).status).toBe(201);
  });
});

describe("queries", () => {
  it("filters by status, due range and text", async () => {
    await task("Pay rent", { dueDate: "2026-11-01" });
    await task("Call dentist", { dueDate: "2026-11-10", notes: "about the RENT receipt" });
    const done = await task("Done thing", { dueDate: "2026-10-01" });
    await api("POST", `/api/tasks/${done.id}/complete`);

    expect(await query()).toEqual(["Pay rent", "Call dentist"]);
    expect(await query("?status=completed")).toEqual(["Done thing"]);
    expect(await query("?status=all")).toHaveLength(3);
    expect(await query("?dueBefore=2026-11-05")).toEqual(["Pay rent"]);
    expect(await query("?dueAfter=2026-11-05")).toEqual(["Call dentist"]);
    expect(await query("?q=rent")).toEqual(["Pay rent", "Call dentist"]);
  });

  it("filters by list and parent, and pages", async () => {
    await task("In inbox");
    await api("POST", "/api/tasks", { listId: other.id, title: "In other" });
    expect(await query(`?listId=${other.id}`)).toEqual(["In other"]);
    expect(await query("?limit=1&offset=1")).toHaveLength(1);
    expect((await api("GET", "/api/tasks?limit=0")).status).toBe(400);
  });
});

describe("completion", () => {
  it("completes and reopens idempotently, logging once each", async () => {
    const t = await task("T");
    const first = (await api("POST", `/api/tasks/${t.id}/complete`)).body;
    expect(first.completedAt).not.toBeNull();
    expect((await api("POST", `/api/tasks/${t.id}/complete`)).body.completedAt).toBe(first.completedAt);
    expect((await api("POST", `/api/tasks/${t.id}/uncomplete`)).body.completedAt).toBeNull();

    const log = await db.select().from(events).where(eq(events.entityId, t.id));
    expect(log.map((e) => e.type).sort()).toEqual(["completed", "created", "uncompleted"]);
  });
});

describe("nesting and moving", () => {
  it("nests under a parent and rejects bad parents", async () => {
    const parent = await task("Parent");
    const child = await task("Child", { parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(await query(`?parentId=${parent.id}`)).toEqual(["Child"]);

    const heading = await task("Section", { kind: "heading" });
    expect((await api("POST", "/api/tasks", { listId: inbox.id, title: "x", parentId: heading.id })).status).toBe(422);
    expect((await api("POST", "/api/tasks", { listId: inbox.id, title: "H", kind: "heading", parentId: parent.id })).status).toBe(422);
    expect((await api("POST", "/api/tasks", { listId: other.id, title: "x", parentId: parent.id })).status).toBe(422);
  });

  it("refuses to move a task inside its own subtree", async () => {
    const parent = await task("Parent");
    const child = await task("Child", { parentId: parent.id });
    const res = await api("POST", `/api/tasks/${parent.id}/move`, { parentId: child.id });
    expect(res.status).toBe(422);
  });

  it("reorders in place", async () => {
    const a = await task("A");
    await task("B");
    const c = await task("C");
    await api("POST", `/api/tasks/${c.id}/move`, { beforeId: a.id });
    expect(await query()).toEqual(["C", "A", "B"]);
  });

  it("moves a subtree to another list", async () => {
    const parent = await task("Parent");
    const child = await task("Child", { parentId: parent.id });
    const moved = await api("POST", `/api/tasks/${parent.id}/move`, { listId: other.id });
    expect(moved.body.listId).toBe(other.id);
    expect((await api("GET", `/api/tasks/${child.id}`)).body).toMatchObject({ listId: other.id, parentId: parent.id });
  });

  it("moves a child to the top level of another list", async () => {
    const parent = await task("Parent");
    const child = await task("Child", { parentId: parent.id });
    const res = await api("POST", `/api/tasks/${child.id}/move`, { listId: other.id });
    expect(res.body).toMatchObject({ listId: other.id, parentId: null });
  });
});

describe("delete", () => {
  it("soft-deletes a task with its subtree and logs each", async () => {
    const parent = await task("Parent");
    const child = await task("Child", { parentId: parent.id });
    expect((await api("DELETE", `/api/tasks/${parent.id}`)).status).toBe(204);
    expect((await api("GET", `/api/tasks/${parent.id}`)).status).toBe(404);
    expect((await api("GET", `/api/tasks/${child.id}`)).status).toBe(404);
    expect(await query("?status=all")).toEqual([]);

    const log = await db.select().from(events).where(eq(events.entityId, child.id));
    expect(log.map((e) => e.type).sort()).toEqual(["created", "deleted"]);
  });

  it("lets a list be deleted once its tasks are", async () => {
    const t = await task("T");
    expect((await api("DELETE", `/api/lists/${inbox.id}`)).status).toBe(409);
    await api("DELETE", `/api/tasks/${t.id}`);
    expect((await api("DELETE", `/api/lists/${inbox.id}`)).status).toBe(204);
  });
});
