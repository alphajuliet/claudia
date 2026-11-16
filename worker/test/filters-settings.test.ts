import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let list: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "web" });
  list = (await api("POST", "/api/lists", { name: "Inbox" })).body;
});

const task = async (title: string, extra: object = {}) =>
  (await api("POST", "/api/tasks", { listId: list.id, title, ...extra })).body;
const filter = async (name: string, query: string, extra: object = {}) =>
  (await api("POST", "/api/filters", { name, query, ...extra })).body;
const result = async (id: string, qs = "") => (await api("GET", `/api/filters/${id}/tasks${qs}`)).body;
const run = async (id: string, qs = "") => (await result(id, qs)).tasks.map((t: { title: string }) => t.title);

describe("filters", () => {
  it("runs a saved search and reflects later changes to tasks", async () => {
    const next = await filter("Next", "#next due:<=2026-11-05");
    await task("Soon", { labels: ["next"], dueDate: "2026-11-01" });
    await task("Later", { labels: ["next"], dueDate: "2026-12-01" });
    await task("Unlabelled", { dueDate: "2026-11-01" });
    expect(await run(next.id)).toEqual(["Soon"]);

    const t = await task("Added after", { labels: ["next"], dueDate: "2026-11-02" });
    expect(await run(next.id)).toEqual(["Soon", "Added after"]);
    await api("POST", `/api/tasks/${t.id}/complete`);
    expect(await run(next.id)).toEqual(["Soon"]);
  });

  it("moves a top-level sort: and group: out of the query into their own fields", async () => {
    const f = await filter("Soon", "#next AND sort:due-desc group:label");
    expect(f).toMatchObject({ query: "#next", sort: "due-desc", group: "label", display: {}, folderId: null });
    expect((await filter("Only", "sort:title")).query).toBe("");
    // Given ones win over those in the query; null clears.
    expect(await filter("Both", "#a sort:due", { sort: "title", group: null })).toMatchObject({ query: "#a", sort: "title", group: null });
    const updated = (await api("PATCH", `/api/filters/${f.id}`, { query: "#wip group:due" })).body;
    expect(updated).toMatchObject({ query: "#wip", sort: "due-desc", group: "due" });
    expect((await api("PATCH", `/api/filters/${f.id}`, { sort: null, display: { showCompleted: true } })).body)
      .toMatchObject({ query: "#wip", sort: null, group: "due", display: { showCompleted: true } });
  });

  it("runs in its sort, and says the sort and grouping", async () => {
    const f = await filter("By title", "#next", { sort: "title-desc", group: "none" });
    await task("Apple", { labels: ["next"] });
    await task("Banana", { labels: ["next"] });
    expect(await result(f.id)).toMatchObject({ sort: { by: "title", desc: true }, group: { by: "none" } });
    expect(await run(f.id)).toEqual(["Banana", "Apple"]);
  });

  it("lets the run override paging, status and context", async () => {
    const all = await filter("All", "is:open OR is:completed");
    await task("A");
    await task("B");
    expect(await run(all.id, "?limit=1")).toEqual(["A"]);
    expect(await run(all.id, "?limit=1&offset=1")).toEqual(["B"]);

    const next = await filter("Next", "#next");
    await task("Open", { labels: ["next"] });
    const done = await task("Done", { labels: ["next"] });
    await api("POST", `/api/tasks/${done.id}/complete`);
    expect(await run(next.id)).toEqual(["Open"]);
    expect(await run(next.id, "?status=completed")).toEqual(["Done"]);
    expect(await run(next.id, "?status=all")).toEqual(["Open", "Done"]);
    expect((await api("GET", `/api/filters/${next.id}/tasks?status=nope`)).status).toBe(400);

    const work = (await api("POST", "/api/folders", { name: "Work", context: "work" })).body;
    const desk = (await api("POST", "/api/lists", { name: "Desk", folderId: work.id })).body;
    await api("POST", "/api/tasks", { listId: desk.id, title: "At work", labels: ["next"] });
    expect(await run(next.id, "?context=home")).toEqual(["Open"]);
    expect(await run(next.id, "?context=work")).toEqual(["Open", "At work"]);
  });

  it("rejects an invalid query, sort or grouping on create and update", async () => {
    const bad = await api("POST", "/api/filters", { name: "Bad", query: "colour:red" });
    expect(bad).toMatchObject({ status: 422, body: { error: { code: "invalid_query" } } });
    expect((await api("POST", "/api/filters", { name: "Bad", query: "", sort: "sideways" })).status).toBe(400);
    const ok = await filter("Ok", "#next");
    expect((await api("PATCH", `/api/filters/${ok.id}`, { query: "#next | #wip" })).status).toBe(422);
    expect((await api("PATCH", `/api/filters/${ok.id}`, { group: "colour" })).status).toBe(400);
    expect((await api("PATCH", `/api/filters/${ok.id}`, { name: "Renamed" })).body).toMatchObject({ name: "Renamed", query: "#next" });
  });

  it("orders, updates and soft-deletes", async () => {
    const a = await filter("A", "");
    await filter("B", "");
    const c = await filter("C", "");
    await api("POST", `/api/filters/${c.id}/move`, { beforeId: a.id });
    const names = async () => (await api("GET", "/api/filters")).body.map((f: { name: string }) => f.name);
    expect(await names()).toEqual(["C", "A", "B"]);

    expect((await api("DELETE", `/api/filters/${a.id}`)).status).toBe(204);
    expect(await names()).toEqual(["C", "B"]);
    expect((await api("GET", `/api/filters/${a.id}/tasks`)).status).toBe(404);
    const log = await db.select().from(events).where(eq(events.entityId, a.id));
    expect(log.map((e) => e.type).sort()).toEqual(["created", "deleted"]);
  });

  it("keeps filters in folders, ordered within each, and a folder with one isn't empty", async () => {
    const work = (await api("POST", "/api/folders", { name: "Work", context: "work" })).body;
    const a = await filter("A", "", { folderId: work.id });
    const b = await filter("B", "", { folderId: work.id });
    const loose = await filter("Loose", "");
    expect(a).toMatchObject({ folderId: work.id });
    expect((await api("POST", "/api/filters", { name: "X", query: "", folderId: "01HZZZZZZZZZZZZZZZZZZZZZZZ" })).status).toBe(404);

    // Into the folder, before A; then out again, last.
    expect((await api("POST", `/api/filters/${loose.id}/move`, { folderId: work.id, beforeId: a.id })).body).toMatchObject({ folderId: work.id });
    const inWork = async () =>
      (await api("GET", "/api/filters")).body.filter((f: { folderId: string | null }) => f.folderId === work.id).map((f: { name: string }) => f.name);
    expect(await inWork()).toEqual(["Loose", "A", "B"]);
    expect((await api("POST", `/api/filters/${a.id}/move`, { beforeId: b.id })).status).toBe(200);
    expect(await api("POST", `/api/filters/${a.id}/move`, { folderId: null, beforeId: b.id })).toMatchObject({ status: 422 });

    expect((await api("DELETE", `/api/folders/${work.id}`)).status).toBe(409);
    for (const f of [a, b, loose]) await api("POST", `/api/filters/${f.id}/move`, { folderId: null });
    expect(await inWork()).toEqual([]);
    expect((await api("DELETE", `/api/folders/${work.id}`)).status).toBe(204);
  });
});

describe("settings", () => {
  const keymap = { "task.complete": ["x"], "go.today": ["g t"] };

  it("sets, reads and replaces values of any JSON shape", async () => {
    expect((await api("GET", "/api/settings")).body).toEqual({});
    await api("PUT", "/api/settings/keymap", { value: keymap });
    await api("PUT", "/api/settings/timeZone", { value: "Australia/Sydney" });
    expect((await api("GET", "/api/settings")).body).toEqual({ keymap, timeZone: "Australia/Sydney" });
    expect((await api("GET", "/api/settings/keymap")).body.value).toEqual(keymap);

    await api("PUT", "/api/settings/keymap", { value: { "task.complete": ["c"] } });
    expect((await api("GET", "/api/settings/keymap")).body.value).toEqual({ "task.complete": ["c"] });
  });

  it("removes a setting", async () => {
    await api("PUT", "/api/settings/timeZone", { value: "UTC" });
    expect((await api("DELETE", "/api/settings/timeZone")).status).toBe(204);
    expect((await api("GET", "/api/settings/timeZone")).status).toBe(404);
    expect((await api("DELETE", "/api/settings/timeZone")).status).toBe(404);
  });

  it("validates keys and requires a value", async () => {
    expect((await api("PUT", "/api/settings/Bad Key", { value: 1 })).status).toBe(400);
    expect((await api("PUT", "/api/settings/ok", {})).status).toBe(400);
  });

  // Events are append-only, so this test uses a key no other test touches.
  it("logs created, updated and deleted with before/after", async () => {
    await api("PUT", "/api/settings/auditedKey", { value: "UTC" });
    await api("PUT", "/api/settings/auditedKey", { value: "Australia/Sydney" });
    await api("DELETE", "/api/settings/auditedKey");
    const log = (await db.select().from(events).where(eq(events.entityId, "auditedKey"))).sort((a, b) => a.id.localeCompare(b.id));
    expect(log.map((e) => e.type)).toEqual(["created", "updated", "deleted"]);
    expect(log[1]).toMatchObject({ before: "UTC", after: "Australia/Sydney" });
  });
});
