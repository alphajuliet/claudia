import type { List, Task } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { groupByList, isSnoozed, treeRows } from "./tasks";

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
  recurFrom: null,
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
