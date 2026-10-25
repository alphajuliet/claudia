import { describe, expect, it } from "vitest";
import {
  contextFor,
  importId,
  recurrence,
  sydneyDate,
  sydneyMidnight,
  transform,
  type GsExport,
  type GsLabel,
  type GsList,
  type GsTask,
} from "../scripts/godspeed/transform";

const T = "2026-01-04T02:40:31.238Z";

const list = (id: string, name: string, order: number, indent: number, type: GsList["list_type"], extra: Partial<GsList> = {}): GsList => ({
  id, name, order_index: order, indent_level: indent, list_type: type, created_at: T, updated_at: T,
  archived_at: null, smart_list_query: null, ...extra,
});
const task = (id: string, listId: string, order: number, indent: number, title: string, extra: Partial<GsTask> = {}): GsTask => ({
  id, list_id: listId, title, notes: null, order_index: order, indent_level: indent, created_at: T, updated_at: T,
  completed_at: null, cleared_at: null, completed_parent_todo_item_id: null, due_at: null, timeless_due_at: null,
  starts_at: null, timeless_starts_at: null, snoozed_until: null, timeless_snoozed_until: null,
  duration_minutes: null, label_ids: [], metadata: null, repeat_from: null, repeat_unit: null,
  repeat_value: null, repeat_unit_metadata: null, ...extra,
});
const label = (id: string, name: string, extra: Partial<GsLabel> = {}): GsLabel => ({ id, name, created_at: T, deleted_at: null, ...extra });

const sample = (over: Partial<GsExport> = {}): GsExport => ({
  lists: [
    list("inbox", "Inbox", 1, 0, "inbox"),
    list("filters", "Filters", 2, 0, "folder"),
    list("smart", "My today", 3, 1, "smart", { smart_list_query: "label:wip" }),
    list("work", "🏢 Work", 4, 0, "folder"),
    list("bus", "🌱 Bus dev", 5, 1, "folder"),
    list("bids", "Bids", 6, 2, "list"),
    list("home", "🏡 Home", 7, 0, "folder"),
    list("house", "Household", 8, 1, "list"),
  ],
  labels: [label("l1", "next"), label("l2", "wip"), label("l3", "gone", { deleted_at: T })],
  open: [],
  completed: [],
  ...over,
});

describe("importId", () => {
  it("is a valid ULID, stable for the same input and distinct otherwise", async () => {
    const a = await importId("task", "abc", T);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await importId("task", "abc", T)).toBe(a);
    expect(await importId("task", "abd", T)).not.toBe(a);
    expect(await importId("list", "abc", T)).not.toBe(a);
  });

  it("sorts by creation time", async () => {
    const early = await importId("task", "x", "2025-01-01T00:00:00.000Z");
    const late = await importId("task", "x", "2026-01-01T00:00:00.000Z");
    expect(early < late).toBe(true);
  });
});

describe("dates", () => {
  it("finds the Sydney date for an instant", () => {
    expect(sydneyDate("2026-01-14T23:30:00.000Z")).toBe("2026-01-15"); // AEDT, +11
    expect(sydneyDate("2026-07-14T13:30:00.000Z")).toBe("2026-07-14"); // AEST, +10
  });

  it("converts a Sydney date to its midnight in UTC, across daylight saving", () => {
    expect(sydneyMidnight("2026-01-15")).toBe("2026-01-14T13:00:00.000Z");
    expect(sydneyMidnight("2026-07-15")).toBe("2026-07-14T14:00:00.000Z");
    expect(sydneyMidnight("2026-10-04")).toBe("2026-10-03T14:00:00.000Z"); // DST starts at 2am this day
  });
});

describe("recurrence", () => {
  const rep = (unit: string, value: number, from: string, meta: GsTask["repeat_unit_metadata"] = null) =>
    recurrence(task("t", "l", 1, 1, "x", { repeat_unit: unit, repeat_value: value, repeat_from: from, repeat_unit_metadata: meta }));

  it("maps units, intervals and anchors to RRULEs", () => {
    expect(rep("days", 1, "due date")).toEqual({ recurRule: "FREQ=DAILY", recurFrom: "due" });
    expect(rep("days", 2, "completion")).toEqual({ recurRule: "FREQ=DAILY;INTERVAL=2", recurFrom: "completion" });
    expect(rep("weeks", 1, "due date", { weekdays: ["Mon", "Wed", "Fri"] })).toEqual({ recurRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", recurFrom: "due" });
    expect(rep("weeks", 2, "completion", { weekdays: [] })).toEqual({ recurRule: "FREQ=WEEKLY;INTERVAL=2", recurFrom: "completion" });
    expect(rep("months", 1, "completion", { monthDays: [] })).toEqual({ recurRule: "FREQ=MONTHLY", recurFrom: "completion" });
    expect(rep("months", 3, "due date", { monthDays: [1, 15] })).toEqual({ recurRule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1,15", recurFrom: "due" });
    expect(rep("years", 1, "due date")).toEqual({ recurRule: "FREQ=YEARLY", recurFrom: "due" });
  });

  it("returns null when not repeating and an error for shapes it doesn't know", () => {
    expect(recurrence(task("t", "l", 1, 1, "x"))).toBeNull();
    expect(rep("fortnights", 1, "due date")).toMatchObject({ error: expect.stringContaining("fortnights") });
    expect(rep("days", 1, "whenever")).toMatchObject({ error: expect.stringContaining("whenever") });
    expect(rep("weeks", 1, "due date", { weekdays: ["Funday"] })).toMatchObject({ error: expect.any(String) });
  });
});

describe("structure", () => {
  it("builds folders with inherited contexts, skips smart lists and their folder", async () => {
    const r = await transform(sample());
    expect(r.folders.map((f) => [f.name, f.context, f.parentId !== null])).toEqual([
      ["🏢 Work", "work", false], ["🌱 Bus dev", "work", true], ["🏡 Home", "home", false],
    ]);
    expect(r.lists.map((l) => [l.name, l.folderId !== null])).toEqual([["Inbox", false], ["Bids", true], ["Household", true]]);
    expect(r.report.skippedSmartLists).toEqual([{ name: "My today", query: "label:wip" }]);
    expect(r.report.skippedFolders).toEqual(["Filters"]);
    const bus = r.folders.find((f) => f.name.includes("Bus"))!;
    expect(r.lists.find((l) => l.name === "Bids")!.folderId).toBe(bus.id);
    expect(bus.parentId).toBe(r.folders.find((f) => f.name.includes("Work"))!.id);
  });

  it("keeps Godspeed's order among siblings", async () => {
    const r = await transform(sample({ lists: sample().lists.reverse().map((l, i) => ({ ...l, order_index: 100 - i })).reverse() }));
    const top = r.folders.filter((f) => !f.parentId);
    expect(top.map((f) => f.name)).toEqual(["🏢 Work", "🏡 Home"]);
    expect(top[0]!.position < top[1]!.position).toBe(true);
  });

  it("warns about a top-level folder with no context and archives archived lists", async () => {
    const r = await transform({
      ...sample(),
      lists: [list("x", "Hobbies", 1, 0, "folder"), list("y", "Old", 2, 1, "list", { archived_at: T })],
    });
    expect(r.folders[0]!.context).toBe("personal");
    expect(r.report.warnings[0]).toContain("Hobbies");
    expect(r.lists[0]!.archivedAt).toBe(T);
  });

  it("recognises contexts despite emoji", () => {
    expect([contextFor("🏢 Work"), contextFor("🚀 Personal"), contextFor("🏡 Home"), contextFor("Other")]).toEqual(["work", "personal", "home", null]);
  });
});

describe("labels", () => {
  it("drops deleted labels and merges names that differ only by case", async () => {
    const r = await transform(sample({ labels: [label("a", "Next"), label("b", "next"), label("c", "gone", { deleted_at: T })] }));
    expect(r.labels.map((l) => l.name)).toEqual(["Next"]);
    expect(r.report.mergedLabels).toEqual([{ from: "next", into: "Next" }]);
    const t = await transform(sample({ labels: [label("a", "Next"), label("b", "next")], open: [task("t", "house", 1, 1, "T", { label_ids: ["a", "b", "unknown"] })] }));
    expect(t.tasks[0]!.labelIds).toEqual([t.labels[0]!.id]);
  });
});

describe("tasks", () => {
  const open = (tasks: GsTask[]) => transform(sample({ open: tasks }));
  const titles = (r: Awaited<ReturnType<typeof open>>) => r.tasks.map((t) => t.title);

  it("turns :: titles into headings and nests by indent, never under a heading", async () => {
    const r = await open([
      task("h1", "house", 1, 0, ":: General"),
      task("a", "house", 2, 1, "A"),
      task("a1", "house", 3, 2, "A1"),
      task("a11", "house", 4, 3, "A11"),
      task("a2", "house", 5, 2, "A2"),
      task("b", "house", 6, 1, "B"),
      task("h2", "house", 7, 0, ":: Maintenance"),
      task("c", "house", 8, 1, "C"),
    ]);
    const byTitle = Object.fromEntries(r.tasks.map((t) => [t.title, t]));
    expect(byTitle.General).toMatchObject({ kind: "heading", parentId: null });
    expect(byTitle.A).toMatchObject({ kind: "task", parentId: null });
    expect(byTitle.A1!.parentId).toBe(byTitle.A!.id);
    expect(byTitle.A11!.parentId).toBe(byTitle.A1!.id);
    expect(byTitle.A2!.parentId).toBe(byTitle.A!.id);
    expect(byTitle.B!.parentId).toBeNull();
    expect(byTitle.C!.parentId).toBeNull();
  });

  it("handles lists whose top level is indent 0, like the Inbox", async () => {
    const r = await transform(sample({ open: [task("a", "inbox", 1, 0, "A"), task("a1", "inbox", 2, 1, "A1"), task("b", "inbox", 3, 0, "B")] }));
    const byTitle = Object.fromEntries(r.tasks.map((t) => [t.title, t]));
    expect(byTitle.A1!.parentId).toBe(byTitle.A!.id);
    expect(byTitle.B!.parentId).toBeNull();
  });

  it("orders by order_index and lists parents before children with unique positions", async () => {
    const r = await open([task("b", "house", 20, 1, "B"), task("a", "house", 10, 1, "A"), task("a1", "house", 15, 2, "A1")]);
    expect(titles(r)).toEqual(["A", "A1", "B"]);
    const top = r.tasks.filter((t) => !t.parentId);
    expect(top[0]!.position < top[1]!.position).toBe(true);
  });

  it("maps dates, notes, duration and recurrence", async () => {
    const r = await open([
      task("a", "house", 1, 1, "Dated", { timeless_due_at: "2026-11-02", starts_at: "2026-01-14T23:30:00.000Z", timeless_snoozed_until: "2026-01-15", notes: "n", duration_minutes: 15 }),
      task("b", "house", 2, 1, "Timed", { due_at: "2026-11-02T01:00:00Z" }),
      task("c", "house", 3, 1, "Repeats", { repeat_unit: "weeks", repeat_value: 1, repeat_from: "due date", repeat_unit_metadata: { weekdays: ["Sat"] } }),
      task("d", "house", 4, 1, "Blank", { notes: "   " }),
    ]);
    const [a, b, c, d] = r.tasks;
    expect(a).toMatchObject({ dueDate: "2026-11-02", dueAt: null, startDate: "2026-01-15", snoozedUntil: "2026-01-14T13:00:00.000Z", notes: "n" });
    expect(a!.metadata).toEqual({ godspeed: { id: "a", durationMinutes: 15, startsAt: "2026-01-14T23:30:00.000Z" } });
    expect(b).toMatchObject({ dueDate: null, dueAt: "2026-11-02T01:00:00.000Z" });
    expect(c).toMatchObject({ recurRule: "FREQ=WEEKLY;BYDAY=SA", recurFrom: "due" });
    expect(d!.notes).toBeNull();
  });

  it("keeps an unmappable recurrence in metadata and reports it", async () => {
    const r = await open([task("a", "house", 1, 1, "Odd", { repeat_unit: "fortnights", repeat_value: 1, repeat_from: "due date" })]);
    expect(r.tasks[0]).toMatchObject({ recurRule: null, recurFrom: null });
    expect((r.tasks[0]!.metadata as any).godspeed.repeat).toMatchObject({ unit: "fortnights" });
    expect(r.report.droppedRecurrence).toHaveLength(1);
  });

  it("imports completed tasks as history, without live recurrence", async () => {
    const r = await transform(sample({
      open: [task("p", "house", 1, 1, "Parent")],
      completed: [
        task("c1", "house", 1, 1, "Child", { completed_at: "2026-02-01T00:00:00.000Z", completed_parent_todo_item_id: "p" }),
        task("c2", "house", 2, 1, "Cleared", { cleared_at: "2026-02-02T00:00:00.000Z", repeat_unit: "days", repeat_value: 1, repeat_from: "completion" }),
        task("c3", "house", 3, 1, "No time", {}),
        task("c4", "gone-list", 4, 1, "Orphan list", { completed_at: T }),
      ],
    }));
    const byTitle = Object.fromEntries(r.tasks.map((t) => [t.title, t]));
    expect(byTitle.Child).toMatchObject({ completedAt: "2026-02-01T00:00:00.000Z", parentId: byTitle.Parent!.id });
    expect(byTitle.Cleared).toMatchObject({ completedAt: "2026-02-02T00:00:00.000Z", recurRule: null });
    expect((byTitle.Cleared!.metadata as any).godspeed.repeat).toMatchObject({ unit: "days" });
    expect(byTitle["No time"]!.completedAt).toBe(T);
    expect(byTitle["Orphan list"]).toBeUndefined();
    expect(r.report.skippedTasks).toEqual([{ id: "c4", reason: "its list was not imported" }]);
  });

  it("is deterministic", async () => {
    const data = sample({ open: [task("a", "house", 1, 1, "A")] });
    expect(await transform(data)).toEqual(await transform(data));
  });
});
