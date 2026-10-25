import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
beforeEach(async () => {
  await reset();
  api = client(await makeToken(["admin"]), { "X-Claudia-Client": "web" });
});

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, "0").replace(/0/g, "A").replace(/1/g, "B")}`.slice(0, 26);
const T0 = "2025-12-22T02:01:28.717Z";
const T1 = "2026-03-01T00:00:00.000Z";

const folder = (n: number, extra = {}) => ({ id: id(n), name: `F${n}`, parentId: null, context: "work", position: "a0", createdAt: T0, updatedAt: T0, ...extra });
const list = (n: number, extra = {}) => ({ id: id(n), name: `L${n}`, folderId: null, position: "a0", archivedAt: null, createdAt: T0, updatedAt: T0, ...extra });
const label = (n: number, name: string) => ({ id: id(n), name, createdAt: T0 });
const task = (n: number, extra = {}) => ({
  id: id(n), listId: id(20), parentId: null, kind: "task", position: "a0", title: `T${n}`, notes: null,
  dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null,
  completedAt: null, metadata: null, labelIds: [], createdAt: T0, updatedAt: T1, ...extra,
});

describe("import", () => {
  it("is admin-only", async () => {
    const write = client(await makeToken(["write"]));
    expect((await write("POST", "/api/import", {})).status).toBe(403);
  });

  it("inserts everything with original timestamps, nesting and labels", async () => {
    const res = await api("POST", "/api/import", {
      folders: [folder(2, { parentId: id(1) }), folder(1)],
      lists: [list(20, { folderId: id(2), archivedAt: T1 })],
      labels: [label(30, "next"), label(31, "wip")],
      tasks: [
        task(41, { parentId: id(40) }),
        task(40, { labelIds: [id(30), id(31)], completedAt: T1, dueDate: "2026-03-02" }),
        task(42, { kind: "heading", title: "Section" }),
      ],
    });
    expect(res.body).toEqual({
      inserted: { folders: 2, lists: 1, labels: 2, tasks: 3 },
      skipped: { folders: 0, lists: 0, labels: 0, tasks: 0 },
    });

    const parent = (await api("GET", `/api/tasks/${id(40)}`)).body;
    expect(parent).toMatchObject({ createdAt: T0, updatedAt: T1, completedAt: T1, dueDate: "2026-03-02", labels: ["next", "wip"] });
    expect((await api("GET", `/api/tasks/${id(41)}`)).body.parentId).toBe(id(40));
    expect((await api("GET", `/api/folders/${id(2)}`)).body).toMatchObject({ parentId: id(1), createdAt: T0 });
    expect((await api("GET", `/api/lists/${id(20)}`)).body.archivedAt).toBe(T1);
  });

  it("is idempotent and does not overwrite later edits", async () => {
    const batch = { folders: [], lists: [list(20)], labels: [label(30, "next")], tasks: [task(40, { labelIds: [id(30)] })] };
    await api("POST", "/api/import", batch);
    await api("PATCH", `/api/tasks/${id(40)}`, { title: "Edited" });

    const again = await api("POST", "/api/import", batch);
    expect(again.body).toEqual({
      inserted: { folders: 0, lists: 0, labels: 0, tasks: 0 },
      skipped: { folders: 0, lists: 1, labels: 1, tasks: 1 },
    });
    expect((await api("GET", `/api/tasks/${id(40)}`)).body.title).toBe("Edited");
  });

  it("logs an imported event attributed to import, whatever the client claims", async () => {
    await api("POST", "/api/import", { lists: [list(20)], tasks: [task(40)] });
    const [row] = await db.select().from(events).where(eq(events.entityId, id(40)));
    expect(row).toMatchObject({ type: "imported", actor: "import", entityType: "task" });
  });

  it("uses an existing label of the same name instead of creating a duplicate", async () => {
    const mine = (await api("POST", "/api/labels", { name: "Next" })).body;
    await api("POST", "/api/import", { lists: [list(20)], labels: [label(30, "next")], tasks: [task(40, { labelIds: [id(30)] })] });
    expect((await api("GET", "/api/labels")).body).toEqual([mine]);
    expect((await api("GET", `/api/tasks/${id(40)}`)).body.labels).toEqual(["Next"]);
  });

  it("accepts parents already stored by an earlier request", async () => {
    await api("POST", "/api/import", { lists: [list(20)], tasks: [task(40)] });
    const res = await api("POST", "/api/import", { tasks: [task(41, { parentId: id(40) })] });
    expect(res.body.inserted.tasks).toBe(1);
  });

  it("rejects missing references, cycles, bad recurrence and oversize batches", async () => {
    expect((await api("POST", "/api/import", { tasks: [task(40)] }))).toMatchObject({ status: 422, body: { error: { code: "missing_reference" } } });
    await api("POST", "/api/import", { lists: [list(20)] });
    const cycle = await api("POST", "/api/import", { tasks: [task(40, { parentId: id(41) }), task(41, { parentId: id(40) })] });
    expect(cycle).toMatchObject({ status: 422, body: { error: { code: "invalid_parent" } } });
    expect((await api("POST", "/api/import", { tasks: [task(40, { recurRule: "FREQ=DAILY" })] })).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => label(100 + i, `l${i}`));
    expect((await api("POST", "/api/import", { labels: many })).status).toBe(400);
    expect(((await api("GET", "/api/tasks?status=all")).body)).toEqual([]);
  });
});
