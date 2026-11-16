import { describe, expect, it } from "vitest";
import type { List, Task } from "@claudia/shared";
import { searchSections } from "./search";

const at = "2026-11-01T00:00:00.000Z";
const list = (id: string, name: string): List => ({ id, name, folderId: null, position: "a0", archivedAt: null, inbox: false, createdAt: at, updatedAt: at });
const a = list("L1", "Alpha");
const b = list("L2", "Beta");
let seq = 0;
const task = (fields: Partial<Task> & Pick<Task, "title">): Task => ({
  id: `T${++seq}`, listId: a.id, parentId: null, kind: "task", position: `a${seq}`, notes: null, dueDate: null, dueAt: null,
  startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null, priority: "normal", completedAt: null, labels: [],
  metadata: null, createdAt: at, updatedAt: at, ...fields,
});
const ctx = { lists: [a, b], listOrder: [b.id, a.id], today: "2026-11-16", timeZone: "Australia/Sydney" };
const shape = (sections: ReturnType<typeof searchSections>) => sections.map((s) => [s.title, s.rows.map((r) => r.task.title)]);

describe("searchSections", () => {
  const tasks = [
    task({ title: "a1", dueDate: "2026-11-20", labels: ["next"] }),
    task({ title: "a2", dueDate: "2026-11-17", labels: ["wip", "next"], priority: "high" }),
    task({ title: "b1", listId: b.id, labels: ["event"] }),
    task({ title: "b2", listId: b.id, dueDate: "2026-11-16" }),
  ];

  it("groups by list in sidebar order, priority first, by default", () => {
    expect(shape(searchSections(tasks, { sort: { by: "list", desc: false }, group: { by: "list" } }, ctx))).toEqual([
      ["Beta", ["b1", "b2"]],
      ["Alpha", ["a2", "a1"]],
    ]);
  });

  it("sorts within list groups, undated last either way", () => {
    expect(shape(searchSections(tasks, { sort: { by: "due", desc: false }, group: { by: "list" } }, ctx))).toEqual([
      ["Beta", ["b2", "b1"]],
      ["Alpha", ["a2", "a1"]],
    ]);
    expect(shape(searchSections(tasks, { sort: { by: "due", desc: true }, group: { by: "none" } }, ctx))).toEqual([
      [undefined, ["a1", "a2", "b2", "b1"]],
    ]);
  });

  it("groups by due date into the views' buckets", () => {
    expect(shape(searchSections(tasks, { sort: { by: "list", desc: false }, group: { by: "due" } }, ctx)).map(([t]) => t)).toEqual([
      "Today", "Tomorrow", "This week", "No date",
    ]);
  });

  it("puts each task under its first label, given ones first, then alphabetical, then No label", () => {
    expect(shape(searchSections(tasks, { sort: { by: "title", desc: false }, group: { by: "label", labels: ["wip", "Next"] } }, ctx))).toEqual([
      ["wip", ["a2"]],
      ["Next", ["a1"]],
      ["event", ["b1"]],
      ["No label", ["b2"]],
    ]);
  });
});
