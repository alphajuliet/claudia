import type { Folder, Label, List, Task } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { ageOf, dashboard, listsInContext, statusCounts, wipByContext } from "./dashboard";

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
    // Waiting comes before Next 3 days, so a waiting task due soon shows there.
    expect(ids(d.waiting)).toEqual(["soon"]);
    expect(d.nextDays).toEqual([]);
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

const at = "2026-10-01T00:00:00.000Z";
const folder = (id: string, context: Folder["context"], parentId: string | null = null): Folder =>
  ({ id, name: id, parentId, context, position: "a0", createdAt: at, updatedAt: at });
const list = (id: string, folderId: string | null, inbox = false): List =>
  ({ id, name: id, folderId, position: "a0", archivedAt: null, inbox, createdAt: at, updatedAt: at });
const folders = [folder("W", "work"), folder("P", "personal"), folder("Wp", "personal", "W")];
const lists = [list("work", "W"), list("life", "P"), list("odd", "Wp"), list("loose", null), list("in", "P", true)];

describe("contexts", () => {
  it("hold their folders' lists, loose lists and the Inbox, but not a list under a folder from another context", () => {
    expect([...listsInContext(lists, folders, "work")!].sort()).toEqual(["in", "loose", "work"]);
    expect([...listsInContext(lists, folders, "personal")!].sort()).toEqual(["in", "life", "loose"]);
    expect(listsInContext(lists, folders, "all")).toBeNull();
  });

  it("count WIP in each, a loose task in every one", () => {
    const wip = [task("a", { listId: "work" }), task("b", { listId: "work" }), task("c", { listId: "life" }), task("d", { listId: "loose" })];
    expect(wipByContext(wip, lists, folders)).toEqual([
      { context: "work", count: 3 }, { context: "personal", count: 2 }, { context: "home", count: 1 },
    ]);
  });
});

describe("status counts", () => {
  const label = (name: string, statusPosition: string | null): Label =>
    ({ id: name, name, color: null, status: statusPosition !== null, statusPosition, createdAt: at });
  const labels = [label("wip", "a1"), label("next", "a0"), label("errand", null)];
  const counts = { lists: {
    work: { open: 5, today: 0, labels: { next: 2, wip: 1, errand: 3 } },
    life: { open: 2, today: 0, labels: { wip: 1 } },
  } };

  it("go in the status labels' order, then the tasks with none", () => {
    expect(statusCounts(counts, labels, null)).toEqual([
      { label: "next", count: 2 }, { label: "wip", count: 2 }, { label: null, count: 3 },
    ]);
  });

  it("narrow to a context's lists", () => {
    expect(statusCounts(counts, labels, new Set(["life"]))).toEqual([
      { label: "next", count: 0 }, { label: "wip", count: 1 }, { label: null, count: 1 },
    ]);
  });
});
