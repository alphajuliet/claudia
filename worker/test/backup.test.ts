import { env } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import { backupKey, dumpDatabase, literal, parentsFirst, tablesInOrder } from "../src/backup";
import { client, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["admin"]));
});

/** Some of everything, with awkward text. */
async function seed() {
  const folder = (await api("POST", "/api/folders", { name: "Acme's", context: "work" })).body;
  const list = (await api("POST", "/api/lists", { name: "Jobs", folderId: folder.id })).body;
  const parent = (await api("POST", "/api/tasks", { listId: list.id, title: "It's \"quoted\" — ünïcode 🌱", notes: "line one\nline two; DROP TABLE tasks;", labels: ["next"] })).body;
  await api("POST", "/api/tasks", { listId: list.id, parentId: parent.id, title: "Child", dueDate: "2026-11-09", recurRule: "FREQ=WEEKLY", recurFrom: "due", metadata: { a: [1, 2] } });
  await api("PUT", "/api/settings/timeZone", { value: "Australia/Sydney" });
}

const TABLES = ["folders", "lists", "labels", "tasks", "task_labels", "filters", "settings", "tokens"];
const snapshot = async () =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await env.DB.prepare(`SELECT * FROM "${t}" ORDER BY 1, 2`).all()).results])));

describe("literal", () => {
  it("writes SQL literals", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(3)).toBe("3");
    expect(literal("it's")).toBe("'it''s'");
    expect(literal(new Uint8Array([0, 255]))).toBe("X'00ff'");
    expect(literal("a\nb\r\nc")).toBe("'a' || char(10) || 'b' || char(13) || char(10) || 'c'");
  });
});

describe("ordering", () => {
  it("puts tables after the ones they refer to", () => {
    const keys = [
      { tbl: "task_labels", ref: "tasks", from: "task_id", to: "id" },
      { tbl: "task_labels", ref: "labels", from: "label_id", to: "id" },
      { tbl: "tasks", ref: "lists", from: "list_id", to: "id" },
      { tbl: "tasks", ref: "tasks", from: "parent_id", to: "id" },
    ];
    expect(tablesInOrder(["events", "labels", "lists", "task_labels", "tasks"], keys)).toEqual(["events", "labels", "lists", "tasks", "task_labels"]);
  });

  it("puts rows after their parents", () => {
    const rows = [{ id: "c", parent: "b" }, { id: "b", parent: "a" }, { id: "x", parent: null }, { id: "a", parent: null }];
    expect(parentsFirst(rows, "parent", "id").map((r) => r.id)).toEqual(["x", "a", "b", "c"]);
  });
});

describe("dumpDatabase", () => {
  it("writes the schema, then the rows, then indexes and triggers, leaving out Cloudflare's tables", async () => {
    await seed();
    const { sql, rows } = await dumpDatabase(env.DB);
    const lines = sql.split("\n");
    // A row a line: the notes' line breaks are char(10).
    const inserts = lines.filter((l) => l.startsWith("INSERT INTO"));
    expect(inserts.length).toBe(Object.values(rows).reduce((a, b) => a + b, 0));
    expect(inserts.every((l) => l.endsWith(");"))).toBe(true);
    const firstInsert = lines.findIndex((l) => l.startsWith("INSERT"));
    expect(lines.slice(0, firstInsert).some((l) => l.startsWith("CREATE TABLE") && l.includes("`tasks`"))).toBe(true);
    expect(lines.findIndex((l) => l.startsWith("CREATE TRIGGER"))).toBeGreaterThan(firstInsert);
    expect(lines.findIndex((l) => l.includes("tasks_position_unique"))).toBeGreaterThan(firstInsert);
    expect(sql).not.toMatch(/_cf_KV|sqlite_sequence/);
    expect(rows).toMatchObject({ folders: 1, lists: 1, tasks: 2, labels: 1, task_labels: 1 });
    expect(rows.d1_migrations).toBeGreaterThan(0);
    expect(rows.events).toBeGreaterThan(0);
  });

  it("gives back the same rows when its inserts are replayed one at a time, with foreign keys checked as they go", async () => {
    await seed();
    // A parent made after its subtask: the subtask's row comes first by rowid.
    const list = (await api("GET", "/api/lists")).body[0];
    const early = (await api("POST", "/api/tasks", { listId: list.id, title: "Made first" })).body;
    const late = (await api("POST", "/api/tasks", { listId: list.id, title: "Made later" })).body;
    await api("POST", `/api/tasks/${early.id}/move`, { parentId: late.id });
    const before = await snapshot();
    const { sql } = await dumpDatabase(env.DB);
    await reset();
    // Each insert on its own, so a reference to a row not yet written fails at once (no deferring).
    const inserts = sql.split("\n").filter((l) => TABLES.some((t) => l.startsWith(`INSERT INTO "${t}" `)));
    for (const l of inserts) await env.DB.prepare(l).run();
    expect(await snapshot()).toEqual(before);
  });
});

describe("backing up", () => {
  it("writes today's dump to the bucket from POST /api/backup, admin only", async () => {
    await seed();
    const write = client(await makeToken(["write"]));
    expect((await write("POST", "/api/backup")).status).toBe(403);
    const res = await api("POST", "/api/backup");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: backupKey(new Date()), rows: { tasks: 2 } });
    const object = await env.BACKUPS.get(res.body.key);
    const text = await object!.text();
    expect(text.startsWith("-- Claudia backup")).toBe(true);
    expect(res.body.bytes).toBe(new TextEncoder().encode(text).byteLength);
  });

  it("backs up from the nightly cron", async () => {
    await seed();
    const at = new Date("2026-11-08T16:00:00Z");
    await worker.scheduled(createScheduledController({ scheduledTime: at, cron: "0 16 * * *" }), env);
    const object = await env.BACKUPS.get("nightly/claudia-2026-11-08.sql");
    expect(object).not.toBeNull();
    expect(JSON.parse(object!.customMetadata!.rows!)).toMatchObject({ tasks: 2 });
  });
});
