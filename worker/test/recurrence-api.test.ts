import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events, tasks } from "../src/db/schema";
import { DEFAULT_TIME_ZONE, addDays, daysBetween, todayIn } from "../src/lib/recurrence";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let inbox: { id: string };
const today = () => todayIn(DEFAULT_TIME_ZONE);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "shortcut" });
  inbox = (await api("POST", "/api/lists", { name: "Inbox" })).body;
});

const task = async (title: string, extra: object = {}) =>
  (await api("POST", "/api/tasks", { listId: inbox.id, title, ...extra })).body;
const complete = async (id: string) => (await api("POST", `/api/tasks/${id}/complete`)).body;

describe("recurrence validation", () => {
  it("rejects an invalid rule on create and patch", async () => {
    const bad = await api("POST", "/api/tasks", { listId: inbox.id, title: "x", recurRule: "FREQ=HOURLY", recurFrom: "due" });
    expect(bad).toMatchObject({ status: 422, body: { error: { code: "invalid_recurrence" } } });
    const t = await task("R", { recurRule: "FREQ=DAILY", recurFrom: "due" });
    const patched = await api("PATCH", `/api/tasks/${t.id}`, { recurRule: "nonsense" });
    expect(patched).toMatchObject({ status: 422, body: { error: { code: "invalid_recurrence" } } });
  });

  it("accepts a valid rule on patch", async () => {
    const t = await task("R", { recurRule: "FREQ=DAILY", recurFrom: "due" });
    const res = await api("PATCH", `/api/tasks/${t.id}`, { recurRule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(res).toMatchObject({ status: 200, body: { recurRule: "FREQ=WEEKLY;BYDAY=MO" } });
  });
});

describe("completing a recurring task", () => {
  it("advances a weekly task from its due date and keeps it open", async () => {
    const due = addDays(today(), -10);
    const t = await task("Bins", { dueDate: due, recurRule: "FREQ=WEEKLY", recurFrom: "due" });
    const done = await complete(t.id);
    expect(done.completedAt).toBeNull();
    expect(done.dueDate > today()).toBe(true);
    expect(daysBetween(today(), done.dueDate)).toBeLessThanOrEqual(7);
    expect(weekday(done.dueDate)).toBe(weekday(due));
    expect((await api("GET", `/api/tasks/${t.id}`)).body.dueDate).toBe(done.dueDate);
  });

  it("advances from completion", async () => {
    const t = await task("Water", { dueDate: addDays(today(), -3), recurRule: "FREQ=DAILY;INTERVAL=2", recurFrom: "completion" });
    expect((await complete(t.id)).dueDate).toBe(addDays(today(), 2));
  });

  it("gives a task with no due date one", async () => {
    const t = await task("Floss", { recurRule: "FREQ=WEEKLY", recurFrom: "completion" });
    expect((await complete(t.id)).dueDate).toBe(addDays(today(), 7));
  });

  it("shifts the start date, clears the snooze and leaves the rest alone", async () => {
    const due = addDays(today(), -2);
    const t = await task("Report", {
      notes: "n", labels: ["wip"], dueDate: due, startDate: addDays(due, -3),
      snoozedUntil: "2099-01-01T00:00:00.000Z", recurRule: "FREQ=DAILY", recurFrom: "due",
    });
    const done = await complete(t.id);
    const delta = daysBetween(due, done.dueDate);
    expect(done.startDate).toBe(addDays(due, -3 + delta));
    expect(done).toMatchObject({ snoozedUntil: null, title: "Report", notes: "n", labels: ["wip"], position: t.position });
    expect(done.updatedAt >= t.updatedAt).toBe(true);
  });

  it("leaves the start date alone when there was no due date", async () => {
    const t = await task("Floss", { startDate: "2026-01-01", recurRule: "FREQ=DAILY", recurFrom: "completion" });
    expect(await complete(t.id)).toMatchObject({ startDate: "2026-01-01", dueDate: addDays(today(), 1) });
  });

  it("advances twice when completed twice", async () => {
    const t = await task("Daily", { dueDate: today(), recurRule: "FREQ=DAILY", recurFrom: "due" });
    expect((await complete(t.id)).dueDate).toBe(addDays(today(), 1));
    expect((await complete(t.id)).dueDate).toBe(addDays(today(), 2));
  });

  it("logs one completed event with the old and new dates", async () => {
    const due = addDays(today(), -1);
    const t = await task("Bins", { dueDate: due, recurRule: "FREQ=DAILY", recurFrom: "due" });
    const done = await complete(t.id);
    const rows = await db.select().from(events).where(eq(events.entityId, t.id));
    const completed = rows.filter((e) => e.type === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      actor: "shortcut",
      before: { dueDate: due, startDate: null, snoozedUntil: null },
      after: { dueDate: done.dueDate, startDate: null, snoozedUntil: null },
    });
  });

  it("completes normally when the rule has run out", async () => {
    const t = await task("Once", { dueDate: today(), recurRule: "FREQ=DAILY;COUNT=1", recurFrom: "due" });
    expect((await complete(t.id)).completedAt).not.toBeNull();
  });

  it("completes normally when a stored rule cannot be read (for example from an import)", async () => {
    const t = await task("Odd", { dueDate: today(), recurRule: "FREQ=DAILY", recurFrom: "due" });
    await db.update(tasks).set({ recurRule: "nonsense" }).where(eq(tasks.id, t.id));
    const res = await api("POST", `/api/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.completedAt).not.toBeNull();
  });

  it("completes normally when the task has a due time", async () => {
    const t = await task("Call", { dueAt: "2026-12-01T09:00:00.000Z", recurRule: "FREQ=DAILY", recurFrom: "due" });
    expect((await complete(t.id)).completedAt).not.toBeNull();
  });

  it("leaves uncomplete as a no-op on an open recurring task", async () => {
    const t = await task("Bins", { dueDate: today(), recurRule: "FREQ=DAILY", recurFrom: "due" });
    const res = await api("POST", `/api/tasks/${t.id}/uncomplete`);
    expect(res.body).toEqual({ ...t, subtasks: 0 });
  });

  it("advances a repeating parent and leaves its subtasks open", async () => {
    const t = await task("Bins", { dueDate: today(), recurRule: "FREQ=DAILY", recurFrom: "due" });
    const sub = await task("Rinse", { parentId: t.id });
    expect(await complete(t.id)).toMatchObject({ completedAt: null, dueDate: addDays(today(), 1), subtasks: 0 });
    expect((await api("GET", `/api/tasks/${sub.id}`)).body.completedAt).toBeNull();
  });

  it("completes a non-recurring task as before", async () => {
    const t = await task("Plain", { dueDate: today() });
    expect(await complete(t.id)).toMatchObject({ completedAt: expect.any(String), dueDate: today() });
  });
});
