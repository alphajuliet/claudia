import type { List, Task } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { collapseRows, dueBucket, groupByDue, groupByList, isSnoozed, parentsIn, rowsUnder, treeRows, type Row } from "./tasks";

const task = (overrides: Partial<Task> & Pick<Task, "id">): Task => ({
  listId: "L1",
  parentId: null,
  kind: "task",
  position: "a0",
  title: overrides.id,
  notes: null,
  dueDate: null,
  dueAt: null,
  startDate: null,
  snoozedUntil: null,
  recurRule: null,
  recurFrom: null, priority: "normal",
  completedAt: null,
  labels: [],
  metadata: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const list = (id: string, name: string): List => ({
  id,
  name,
  folderId: null,
  inbox: false,
  position: "a0",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

const flat = (rows: ReturnType<typeof treeRows>) => rows.map((r) => [r.task.id, r.depth]);

describe("treeRows", () => {
  it("orders siblings by position with subtasks after their parent", () => {
    const tasks = [
      task({ id: "b", position: "a1" }),
      task({ id: "a", position: "a0" }),
      task({ id: "a2", parentId: "a", position: "a1" }),
      task({ id: "a1", parentId: "a", position: "a0V" }),
      task({ id: "a1x", parentId: "a1", position: "a0" }),
    ];
    expect(flat(treeRows(tasks))).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a1x", 2],
      ["a2", 1],
      ["b", 0],
    ]);
  });

  it("shows a subtask whose parent is missing at the top level", () => {
    const tasks = [task({ id: "x", position: "a1" }), task({ id: "orphan", parentId: "gone", position: "a0" })];
    expect(flat(treeRows(tasks))).toEqual([
      ["orphan", 0],
      ["x", 0],
    ]);
  });
});

describe("groupByList", () => {
  it("groups in list order with unknown lists last", () => {
    const tasks = [
      task({ id: "z", listId: "LZ" }),
      task({ id: "b", listId: "LB" }),
      task({ id: "a2", listId: "LA", position: "a1" }),
      task({ id: "a1", listId: "LA", position: "a0" }),
    ];
    const lists = [list("LA", "Alpha"), list("LB", "Beta")];
    const groups = groupByList(tasks, lists, ["LA", "LB"]);
    expect(groups.map((g) => g.listId)).toEqual(["LA", "LB", "LZ"]);
    expect(groups[0]!.list?.name).toBe("Alpha");
    expect(groups[0]!.rows.map((r) => r.task.id)).toEqual(["a1", "a2"]);
    expect(groups[2]!.list).toBeUndefined();
  });
});

describe("isSnoozed", () => {
  const now = new Date("2026-10-31T00:00:00.000Z");

  it("is true only for a future snoozedUntil", () => {
    expect(isSnoozed(task({ id: "a", snoozedUntil: "2026-11-01T00:00:00.000Z" }), now)).toBe(true);
    expect(isSnoozed(task({ id: "b", snoozedUntil: "2026-10-30T00:00:00.000Z" }), now)).toBe(false);
    expect(isSnoozed(task({ id: "c" }), now)).toBe(false);
  });
});

describe("collapsing", () => {
  // A
  //   B
  //     C
  //   D
  // E
  const rows = treeRows([
    task({ id: "A", position: "a0" }),
    task({ id: "B", parentId: "A", position: "a0" }),
    task({ id: "C", parentId: "B", position: "a0" }),
    task({ id: "D", parentId: "A", position: "a1" }),
    task({ id: "E", position: "a1" }),
  ]);
  const ids = (rs: { task: Task }[]) => rs.map((r) => r.task.id);

  it("finds the tasks with subtasks", () => {
    expect([...parentsIn(rows)]).toEqual(["A", "B"]);
  });

  it("hides everything under a collapsed task, at every level", () => {
    expect(ids(collapseRows(rows, new Set(["A"])))).toEqual(["A", "E"]);
    expect(ids(collapseRows(rows, new Set(["B"])))).toEqual(["A", "B", "D", "E"]);
    expect(ids(collapseRows(rows, new Set(["B", "E"])))).toEqual(["A", "B", "D", "E"]);
    expect(ids(collapseRows(rows, new Set()))).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("lists the rows under a task", () => {
    expect(rowsUnder(rows, "A")).toEqual(["B", "C", "D"]);
    expect(rowsUnder(rows, "B")).toEqual(["C"]);
    expect(rowsUnder(rows, "E")).toEqual([]);
    expect(rowsUnder(rows, "Z")).toEqual([]);
  });
});

describe("priority order", () => {
  const tasks = [
    task({ id: "low", position: "a0", priority: "low" }),
    task({ id: "plain", position: "a1" }),
    task({ id: "high", position: "a2", priority: "high" }),
    task({ id: "alsoHigh", position: "a3", priority: "high" }),
  ];
  const ids = (rows: Row[]) => rows.map((r) => r.task.id);

  it("keeps a list's manual order", () => {
    expect(ids(treeRows(tasks))).toEqual(["low", "plain", "high", "alsoHigh"]);
  });

  it("puts High first and Low last in a view, keeping position within each", () => {
    const [group] = groupByList(tasks, [], ["L1"]);
    expect(ids(group!.rows)).toEqual(["high", "alsoHigh", "plain", "low"]);
  });

  it("sorts subtasks among themselves, under their parent", () => {
    const nested = [
      task({ id: "parent", position: "a0" }),
      task({ id: "sub", parentId: "parent", position: "a0" }),
      task({ id: "urgent", parentId: "parent", position: "a1", priority: "high" }),
      task({ id: "next", position: "a1" }),
    ];
    expect(ids(treeRows(nested, true))).toEqual(["parent", "urgent", "sub", "next"]);
  });
});

describe("dueBucket", () => {
  // 2026-11-10 is a Tuesday; that week ends on Sunday the 15th.
  const today = "2026-11-10";
  it("sorts days into Overdue, Today, Tomorrow, This week, This month, Later and No date", () => {
    expect(dueBucket("2026-11-09", today)).toBe("overdue");
    expect(dueBucket(today, today)).toBe("today");
    expect(dueBucket("2026-11-11", today)).toBe("tomorrow");
    expect(dueBucket("2026-11-15", today)).toBe("week");
    expect(dueBucket("2026-11-16", today)).toBe("month");
    expect(dueBucket("2026-11-30", today)).toBe("month");
    expect(dueBucket("2026-12-01", today)).toBe("later");
    expect(dueBucket(null, today)).toBe("none");
  });

  it("has no This week left on a Sunday, and a week running into next month stays This week", () => {
    expect(dueBucket("2026-11-16", "2026-11-15")).toBe("tomorrow");
    expect(dueBucket("2026-11-17", "2026-11-15")).toBe("month");
    // Thursday 2026-10-29: Sunday is 1 November.
    expect(dueBucket("2026-11-01", "2026-10-29")).toBe("week");
  });
});

describe("groupByDue", () => {
  const tz = "Australia/Sydney";
  it("leaves out empty groups and orders by day, time, priority, list order and position", () => {
    const tasks = [
      task({ id: "none" }),
      task({ id: "later", dueDate: "2027-01-01" }),
      task({ id: "allDay", dueDate: "2026-11-10" }),
      // 9am Sydney time on the 10th.
      task({ id: "timed", dueAt: "2026-11-09T22:00:00.000Z" }),
      task({ id: "high", dueDate: "2026-11-10", priority: "high" }),
      task({ id: "otherList", dueDate: "2026-11-10", listId: "L0" }),
      task({ id: "sub", dueDate: "2026-11-08", parentId: "allDay" }),
    ];
    const groups = groupByDue(tasks, "2026-11-10", tz, ["L0", "L1"]);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.task.id)])).toEqual([
      ["Overdue", ["sub"]],
      ["Today", ["timed", "high", "otherList", "allDay"]],
      ["Later", ["later"]],
      ["No date", ["none"]],
    ]);
    expect(groups.flatMap((g) => g.rows.map((r) => r.depth))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
