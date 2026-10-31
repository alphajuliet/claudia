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
const filter = async (name: string, query: string) =>
  (await api("POST", "/api/filters", { name, query })).body;
const run = async (id: string, qs = "") =>
  (await api("GET", `/api/filters/${id}/tasks${qs}`)).body.map((t: { title: string }) => t.title);

describe("filters", () => {
  it("runs a saved query and reflects later changes to tasks", async () => {
    const next = await filter("Next", "label=next&dueBefore=2026-11-05");
    await task("Soon", { labels: ["next"], dueDate: "2026-11-01" });
    await task("Later", { labels: ["next"], dueDate: "2026-12-01" });
    await task("Unlabelled", { dueDate: "2026-11-01" });
    expect(await run(next.id)).toEqual(["Soon"]);

    const t = await task("Added after", { labels: ["next"], dueDate: "2026-11-02" });
    expect(await run(next.id)).toEqual(["Soon", "Added after"]);
    await api("POST", `/api/tasks/${t.id}/complete`);
    expect(await run(next.id)).toEqual(["Soon"]);
  });

  it("lets the run override paging", async () => {
    const all = await filter("All", "status=all");
    await task("A");
    await task("B");
    expect(await run(all.id, "?limit=1")).toEqual(["A"]);
    expect(await run(all.id, "?limit=1&offset=1")).toEqual(["B"]);
  });

  it("lets the run override the status", async () => {
    const next = await filter("Next", "label=next");
    await task("Open", { labels: ["next"] });
    const done = await task("Done", { labels: ["next"] });
    await api("POST", `/api/tasks/${done.id}/complete`);
    expect(await run(next.id)).toEqual(["Open"]);
    expect(await run(next.id, "?status=completed")).toEqual(["Done"]);
    expect(await run(next.id, "?status=all")).toEqual(["Open", "Done"]);
    expect((await api("GET", `/api/filters/${next.id}/tasks?status=nope`)).status).toBe(400);
  });

  it("rejects an invalid query on create and update", async () => {
    const bad = await api("POST", "/api/filters", { name: "Bad", query: "status=nope" });
    expect(bad).toMatchObject({ status: 422, body: { error: { code: "invalid_query" } } });
    const ok = await filter("Ok", "status=all");
    expect((await api("PATCH", `/api/filters/${ok.id}`, { query: "dueBefore=tomorrow" })).status).toBe(422);
    expect((await api("PATCH", `/api/filters/${ok.id}`, { name: "Renamed" })).body.name).toBe("Renamed");
  });

  it("orders, updates and soft-deletes", async () => {
    const a = await filter("A", "status=all");
    await filter("B", "status=all");
    const c = await filter("C", "status=all");
    await api("POST", `/api/filters/${c.id}/move`, { beforeId: a.id });
    const names = async () => (await api("GET", "/api/filters")).body.map((f: { name: string }) => f.name);
    expect(await names()).toEqual(["C", "A", "B"]);

    expect((await api("DELETE", `/api/filters/${a.id}`)).status).toBe(204);
    expect(await names()).toEqual(["C", "B"]);
    expect((await api("GET", `/api/filters/${a.id}/tasks`)).status).toBe(404);
    const log = await db.select().from(events).where(eq(events.entityId, a.id));
    expect(log.map((e) => e.type).sort()).toEqual(["created", "deleted"]);
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
