import type { Task } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { ageOf, dashboard } from "./dashboard";

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id, listId: "l", parentId: null, kind: "task", title: id, notes: null, position: "a0",
  dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null, priority: "normal",
  completedAt: null, labels: [], metadata: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...fields,
} as Task);

const today = "2026-11-02";
const build = (fields: { wip?: Task[]; due?: Task[]; waiting?: Task[] }) =>
  dashboard({ wip: [], due: [], waiting: [], today, timeZone: "Australia/Sydney", ...fields });
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("dashboard", () => {
  it("splits due tasks at the end of today", () => {
    const d = build({ due: [task("later", { dueDate: "2026-11-03" }), task("now", { dueDate: today }), task("late", { dueDate: "2026-11-01" })] });
    expect(ids(d.dueNow)).toEqual(["late", "now"]);
    expect(ids(d.nextDays)).toEqual(["later"]);
  });

  it("takes the next three days, tomorrow first, and leaves the fourth out", () => {
    const d = build({ due: [
      task("fourth", { dueDate: "2026-11-06" }),
      task("third", { dueDate: "2026-11-05" }),
      task("first", { dueDate: "2026-11-03" }),
    ] });
    expect(ids(d.nextDays)).toEqual(["first", "third"]);
  });

  it("takes a due time's day in the user's time zone", () => {
    // 2 November in Sydney, still 1 November in UTC.
    const d = build({ due: [task("call", { dueAt: "2026-11-01T22:00:00.000Z" })] });
    expect(d.counts).toEqual({ wip: 0, overdue: 0, today: 1 });
  });

  it("drops a task with no date", () => {
    expect(ids(build({ due: [task("none")] }).dueNow)).toEqual([]);
  });

  it("puts a day alone before times on that day, and times in order", () => {
    const d = build({ due: [
      task("late", { dueAt: "2026-11-02T08:00:00.000Z" }),
      task("early", { dueAt: "2026-11-01T22:00:00.000Z" }),
      task("day", { dueDate: today }),
    ] });
    expect(ids(d.dueNow)).toEqual(["day", "early", "late"]);
  });

  it("shows a task once, in the first section it fits", () => {
    const both = task("both", { dueDate: today });
    const soon = task("soon", { dueDate: "2026-11-04" });
    const d = build({ wip: [both], due: [both, soon], waiting: [both, soon] });
    expect(ids(d.wip)).toEqual(["both"]);
    expect(d.dueNow).toEqual([]);
    expect(ids(d.nextDays)).toEqual(["soon"]);
    expect(d.waiting).toEqual([]);
  });

  it("counts before removing duplicates", () => {
    const both = task("both", { dueDate: today });
    const d = build({ wip: [both], due: [both, task("late", { dueDate: "2026-10-30" })] });
    expect(d.counts).toEqual({ wip: 1, overdue: 1, today: 1 });
  });

  it("puts High first and Low last in each section, by date within them", () => {
    const d = build({ due: [
      task("low", { dueDate: "2026-11-01", priority: "low" }),
      task("overdue", { dueDate: "2026-11-01" }),
      task("high", { dueDate: "2026-11-02", priority: "high" }),
    ] });
    expect(ids(d.dueNow)).toEqual(["high", "overdue", "low"]);
  });

  it("keeps WIP's order and puts the oldest waiting task first", () => {
    const d = build({
      wip: [task("b"), task("a")],
      waiting: [task("new", { createdAt: "2026-10-20T00:00:00.000Z" }), task("old", { createdAt: "2026-09-20T00:00:00.000Z" })],
    });
    expect(ids(d.wip)).toEqual(["b", "a"]);
    expect(ids(d.waiting)).toEqual(["old", "new"]);
  });
});

describe("ageOf", () => {
  const created = task("t", { createdAt: "2026-10-20T12:00:00.000Z" });

  it("counts whole days", () => {
    expect(ageOf(created, new Date("2026-11-01T13:00:00.000Z"))).toBe("12d");
  });

  it("has nothing to say in the first day", () => {
    expect(ageOf(created, new Date("2026-10-21T11:00:00.000Z"))).toBeNull();
  });
});
