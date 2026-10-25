import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { events, folders, labels, lists, taskLabels, tasks } from "../src/db/schema";

const db = drizzle(env.DB);
const now = "2026-10-25T03:00:00.000Z";

const folder = { id: "F1", name: "Work", context: "work", position: "a0", createdAt: now, updatedAt: now } as const;
const list = { id: "L1", name: "Inbox", folderId: "F1", position: "a0", createdAt: now, updatedAt: now };
const task = { id: "T1", listId: "L1", title: "Write schema", position: "a0", createdAt: now, updatedAt: now };

async function seed() {
  await db.insert(folders).values(folder);
  await db.insert(lists).values(list);
  await db.insert(tasks).values(task);
}

// Storage is shared across tests; events cannot be deleted, so event tests use unique ids.
beforeEach(async () => {
  for (const table of [taskLabels, tasks, labels, lists, folders]) await db.delete(table);
});

const reject = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow();
};

describe("schema", () => {
  it("creates every table", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      "events", "filters", "folders", "labels", "lists", "settings", "task_labels", "tasks", "tokens",
    ]);
  });

  it("round-trips a task with JSON metadata and applies defaults", async () => {
    await seed();
    await db.update(tasks).set({ metadata: { source: "godspeed", n: 1 } });
    const [row] = await db.select().from(tasks);
    expect(row?.kind).toBe("task");
    expect(row?.metadata).toEqual({ source: "godspeed", n: 1 });
    expect(row?.deletedAt).toBeNull();
  });

  it("rejects an invalid folder context", async () => {
    await reject(db.insert(folders).values({ ...folder, id: "F2", context: "school" as never }));
  });

  it("rejects an unknown kind and requires a task's list to exist", async () => {
    await seed();
    await reject(db.insert(tasks).values({ ...task, id: "T2", kind: "epic" as never }));
    await reject(db.insert(tasks).values({ ...task, id: "T3", listId: "missing" }));
  });

  it("requires recur_rule and recur_from together", async () => {
    await seed();
    await reject(db.insert(tasks).values({ ...task, id: "T2", recurRule: "FREQ=DAILY" }));
    await reject(db.insert(tasks).values({ ...task, id: "T3", recurFrom: "due" }));
    await reject(db.insert(tasks).values({ ...task, id: "T4", recurRule: "FREQ=DAILY", recurFrom: "never" as never }));
    await db.insert(tasks).values({ ...task, id: "T5", recurRule: "FREQ=DAILY", recurFrom: "completion" });
  });

  it("treats label names as unique ignoring case", async () => {
    await db.insert(labels).values({ id: "B1", name: "waitingOn", createdAt: now });
    await reject(db.insert(labels).values({ id: "B2", name: "WAITINGON", createdAt: now }));
  });

  it("links tasks to labels once", async () => {
    await seed();
    await db.insert(labels).values({ id: "B1", name: "next", createdAt: now });
    await db.insert(taskLabels).values({ taskId: "T1", labelId: "B1" });
    await reject(db.insert(taskLabels).values({ taskId: "T1", labelId: "B1" }));
  });
});

describe("events", () => {
  const event = {
    entityType: "task", entityId: "T1", type: "created",
    after: { title: "Write schema" }, at: now, actor: "web",
  } as const;

  it("accepts inserts", async () => {
    await db.insert(events).values({ ...event, id: "E1" });
    const [row] = await db.select().from(events).where(eq(events.id, "E1"));
    expect(row?.after).toEqual({ title: "Write schema" });
  });

  it("is append-only", async () => {
    await db.insert(events).values({ ...event, id: "E3" });
    await expect(env.DB.prepare("UPDATE events SET type = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM events").run()).rejects.toThrow(/append-only/);
  });

  it("rejects an unknown actor", async () => {
    await reject(db.insert(events).values({ ...event, id: "E2", actor: "robot" as never }));
  });
});
