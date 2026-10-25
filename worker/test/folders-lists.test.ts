import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "mcp" });
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);
const folder = async (name: string, extra: object = {}) =>
  (await api("POST", "/api/folders", { name, context: "work", ...extra })).body;
const list = async (name: string, extra: object = {}) =>
  (await api("POST", "/api/lists", { name, ...extra })).body;

describe("folders", () => {
  it("creates in order and moves before/after siblings", async () => {
    const a = await folder("A");
    const b = await folder("B");
    const c = await folder("C");
    expect(names((await api("GET", "/api/folders")).body)).toEqual(["A", "B", "C"]);

    await api("POST", `/api/folders/${c.id}/move`, { beforeId: a.id });
    expect(names((await api("GET", "/api/folders")).body)).toEqual(["C", "A", "B"]);
    await api("POST", `/api/folders/${c.id}/move`, { afterId: a.id });
    expect(names((await api("GET", "/api/folders")).body)).toEqual(["A", "C", "B"]);
    await api("POST", `/api/folders/${a.id}/move`, {});
    expect(names((await api("GET", "/api/folders")).body)).toEqual(["C", "B", "A"]);
  });

  it("updates name and context", async () => {
    const f = await folder("Old");
    const res = await api("PATCH", `/api/folders/${f.id}`, { name: "New", context: "home" });
    expect(res.body).toMatchObject({ name: "New", context: "home" });
  });

  it("nests folders and refuses cycles", async () => {
    const parent = await folder("Parent");
    const child = await folder("Child", { parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    const cycle = await api("POST", `/api/folders/${parent.id}/move`, { parentId: child.id });
    expect(cycle).toMatchObject({ status: 422, body: { error: { code: "invalid_parent" } } });
    expect((await api("POST", `/api/folders/${parent.id}/move`, { parentId: parent.id })).status).toBe(422);
  });

  it("rejects a placement sibling from another scope", async () => {
    const parent = await folder("Parent");
    const other = await folder("Other");
    const child = await folder("Child", { parentId: parent.id });
    const res = await api("POST", `/api/folders/${other.id}/move`, { afterId: child.id });
    expect(res.status).toBe(422);
  });

  it("deletes softly, only when empty", async () => {
    const f = await folder("F");
    await list("L", { folderId: f.id });
    expect((await api("DELETE", `/api/folders/${f.id}`)).status).toBe(409);

    const empty = await folder("Empty");
    expect((await api("DELETE", `/api/folders/${empty.id}`)).status).toBe(204);
    expect((await api("GET", `/api/folders/${empty.id}`)).status).toBe(404);
  });
});

describe("lists", () => {
  it("creates, orders within a folder and moves between folders", async () => {
    const f = await folder("F");
    const a = await list("A", { folderId: f.id });
    const b = await list("B", { folderId: f.id });
    const loose = await list("Loose");
    expect(loose.folderId).toBeNull();

    await api("POST", `/api/lists/${b.id}/move`, { beforeId: a.id });
    const inF = (await api("GET", "/api/lists")).body.filter((l: { folderId: string | null }) => l.folderId === f.id);
    expect(names(inF)).toEqual(["B", "A"]);

    const moved = await api("POST", `/api/lists/${loose.id}/move`, { folderId: f.id });
    expect(moved.body.folderId).toBe(f.id);
    expect((await api("POST", `/api/lists/${a.id}/move`, { folderId: null })).body.folderId).toBeNull();
  });

  it("archives and unarchives, and filters by archived", async () => {
    const l = await list("L");
    await list("Other");
    const archived = await api("PATCH", `/api/lists/${l.id}`, { archived: true });
    expect(archived.body.archivedAt).not.toBeNull();
    expect(names((await api("GET", "/api/lists?archived=true")).body)).toEqual(["L"]);
    expect(names((await api("GET", "/api/lists?archived=false")).body)).toEqual(["Other"]);
    expect((await api("PATCH", `/api/lists/${l.id}`, { archived: false })).body.archivedAt).toBeNull();
  });

  it("rejects a missing folder", async () => {
    const res = await api("POST", "/api/lists", { name: "L", folderId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(res.status).toBe(404);
  });
});

describe("events", () => {
  it("logs each change with before/after and the claimed client", async () => {
    const f = await folder("F");
    await api("PATCH", `/api/folders/${f.id}`, { name: "G" });
    await api("DELETE", `/api/folders/${f.id}`);

    const rows = (await db.select().from(events).where(eq(events.entityId, f.id))).sort((x, y) => x.id.localeCompare(y.id));
    expect(rows.map((r) => r.type)).toEqual(["created", "updated", "deleted"]);
    expect(rows.every((r) => r.actor === "mcp" && r.entityType === "folder")).toBe(true);
    expect(rows[1]).toMatchObject({ before: { name: "F" }, after: { name: "G" } });
  });

  it("does not log a change that failed", async () => {
    const f = await folder("F");
    await list("L", { folderId: f.id });
    await api("DELETE", `/api/folders/${f.id}`);
    const rows = await db.select().from(events).where(eq(events.entityId, f.id));
    expect(rows.map((r) => r.type)).toEqual(["created"]);
  });
});
