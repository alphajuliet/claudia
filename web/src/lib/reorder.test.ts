import type { Task } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { displayItems, gapDepths, headingGaps, indentMove, type Item, moveFor, outdentMove, placeOf, stepMove, withoutDragged } from "./reorder";

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

/** Items from an outline: "# H" is a heading, and two spaces of indent are one level of depth. */
function outline(...lines: string[]): Item[] {
  const parents: string[] = [];
  return lines.map((line) => {
    if (line.startsWith("# ")) {
      parents.length = 0;
      return { kind: "heading", task: task({ id: line.slice(2), kind: "heading" }) };
    }
    const depth = (line.length - line.trimStart().length) / 2;
    const id = line.trim();
    parents.length = depth;
    const t = task({ id, parentId: depth > 0 ? parents[depth - 1]! : null });
    parents[depth] = id;
    return { kind: "row", task: t, depth };
  });
}

const find = (items: Item[], id: string) => items.find((i) => i.task.id === id)!.task;
const ids = (items: Item[]) => items.map((i) => i.task.id);

/** The move for dropping `id` at a drop, worked out over the items without it. */
const drop = (items: Item[], id: string, d: Parameters<typeof moveFor>[2]) => {
  const dragged = find(items, id);
  return moveFor(withoutDragged(items, dragged), dragged, d, items);
};

describe("displayItems", () => {
  it("flattens sections into headings and rows", () => {
    const H = task({ id: "H", kind: "heading" });
    const a = task({ id: "a" });
    const b = task({ id: "b", parentId: "a" });
    const c = task({ id: "c" });
    expect(displayItems([
      { rows: [{ task: a, depth: 0 }, { task: b, depth: 1 }] },
      { heading: H, rows: [{ task: c, depth: 0 }] },
    ])).toEqual([
      { kind: "row", task: a, depth: 0 },
      { kind: "row", task: b, depth: 1 },
      { kind: "heading", task: H },
      { kind: "row", task: c, depth: 0 },
    ]);
  });
});

describe("withoutDragged", () => {
  it("takes out a task and its subtasks", () => {
    const items = outline("a", "  b", "    c", "  d", "e");
    expect(ids(withoutDragged(items, find(items, "b")))).toEqual(["a", "d", "e"]);
  });

  it("takes out a heading and its section", () => {
    const items = outline("a", "# H1", "b", "  c", "# H2", "d");
    expect(ids(withoutDragged(items, find(items, "H1")))).toEqual(["a", "H2", "d"]);
  });

  it("takes the last heading's section to the end", () => {
    const items = outline("a", "# H1", "b", "c");
    expect(ids(withoutDragged(items, find(items, "H1")))).toEqual(["a"]);
  });
});

describe("gapDepths", () => {
  const items = outline("a", "  b", "    c", "d", "# H", "e");

  it("is the top level at the start", () => {
    expect(gapDepths(items, 0)).toEqual({ min: 0, max: 0 });
  });

  it("is the first subtask's depth between a task and its first subtask", () => {
    // Depth 0 here would land after a's subtasks, away from the gap.
    expect(gapDepths(items, 1)).toEqual({ min: 1, max: 1 }); // between a and its subtask b
    expect(gapDepths(items, 2)).toEqual({ min: 2, max: 2 }); // between b and its subtask c
  });

  it("places a drop between a task and its first subtask first under the task", () => {
    const two = outline("a", "  b", "c");
    expect(drop(two, "c", { kind: "gap", index: 1, depth: 1 })).toEqual({ parentId: "a", beforeId: "b" });
  });

  it("ranges from the row below up to the row above", () => {
    expect(gapDepths(items, 3)).toEqual({ min: 0, max: 2 }); // between c and d
  });

  it("is only the top level next to a heading", () => {
    expect(gapDepths(items, 4)).toEqual({ min: 0, max: 0 }); // between d and H
    expect(gapDepths(items, 5)).toEqual({ min: 0, max: 0 }); // between H and e
  });

  it("allows any depth up to the last row at the end", () => {
    const deep = outline("a", "  b", "    c");
    expect(gapDepths(deep, 3)).toEqual({ min: 0, max: 2 });
  });

  it("is the top level in an empty list", () => {
    expect(gapDepths([], 0)).toEqual({ min: 0, max: 0 });
  });
});

describe("headingGaps", () => {
  it("is before each heading and the end", () => {
    expect(headingGaps(outline("a", "# H1", "b", "# H2", "c"))).toEqual([1, 3, 5]);
  });

  it("includes the start when a heading comes first", () => {
    expect(headingGaps(outline("# H1", "b", "# H2"))).toEqual([0, 2, 3]);
  });

  it("is only the end without headings", () => {
    expect(headingGaps(outline("a", "b"))).toEqual([2]);
  });
});

describe("placeOf", () => {
  const items = outline("a", "  b", "  c", "d", "# H", "e");

  it("is the parent and the next sibling", () => {
    expect(placeOf(items, find(items, "b"))).toEqual({ parentId: "a", beforeId: "c" });
    expect(placeOf(items, find(items, "a"))).toEqual({ parentId: null, beforeId: "d" });
  });

  it("leaves the placement out for the last child", () => {
    expect(placeOf(items, find(items, "c"))).toEqual({ parentId: "a" });
  });

  it("places a task straight after a heading first under it", () => {
    expect(placeOf(items, find(items, "e"))).toEqual({ parentId: null, afterId: "H" });
  });

  it("counts a heading as the next top-level sibling", () => {
    expect(placeOf(items, find(items, "d"))).toEqual({ parentId: null, beforeId: "H" });
  });

  it("places a heading before the next heading, past its section", () => {
    const two = outline("# H1", "a", "# H2", "b");
    expect(placeOf(two, find(two, "H1"))).toEqual({ parentId: null, beforeId: "H2" });
    expect(placeOf(two, find(two, "H2"))).toEqual({ parentId: null });
  });
});

describe("a subtask shown at the top level (its parent isn't on screen)", () => {
  // b's parent p is completed and hidden, so b shows at depth 0.
  const orphan = (): Item[] => {
    const items = outline("a", "b", "c");
    items[1] = { ...items[1]!, task: { ...items[1]!.task, parentId: "p" } } as Item;
    return items;
  };

  it("is placed at the top level", () => {
    const items = orphan();
    expect(placeOf(items, find(items, "b"))).toEqual({ parentId: null, beforeId: "c" });
  });

  it("sends nothing for a drop where it is", () => {
    const items = orphan();
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 0 })).toBeNull();
  });

  it("moves to the top level when dropped or stepped elsewhere", () => {
    const items = orphan();
    expect(drop(items, "b", { kind: "gap", index: 0, depth: 0 })).toEqual({ parentId: null, beforeId: "a" });
    expect(stepMove(items, find(items, "b"), 1)).toEqual({ parentId: null });
  });
});

describe("moveFor: gaps", () => {
  it("moves a task to the top", () => {
    const items = outline("a", "b", "c");
    expect(drop(items, "c", { kind: "gap", index: 0, depth: 0 })).toEqual({ parentId: null, beforeId: "a" });
  });

  it("moves a task to the end of the list", () => {
    const items = outline("a", "b", "c");
    // Without a: [b, c], the end is index 2.
    expect(drop(items, "a", { kind: "gap", index: 2, depth: 0 })).toEqual({ parentId: null });
  });

  it("moves a task to depth 1 as a sibling of the subtask above", () => {
    const items = outline("a", "  b", "c");
    // Without c: [a, b], the end at depth 1 is after b under a.
    expect(drop(items, "c", { kind: "gap", index: 2, depth: 1 })).toEqual({ parentId: "a" });
  });

  it("moves a task to depth 2, before the next sibling there", () => {
    const items = outline("a", "  b", "    c", "    d", "e");
    // Without e: gap between c and d at depth 2.
    expect(drop(items, "e", { kind: "gap", index: 3, depth: 2 })).toEqual({ parentId: "b", beforeId: "d" });
  });

  it("puts a task top level after its parent at depth 0", () => {
    const items = outline("a", "  b", "  c", "d");
    // Without c: [a, b, d], the gap after b at depth 0 is before d.
    expect(drop(items, "c", { kind: "gap", index: 2, depth: 0 })).toEqual({ parentId: null, beforeId: "d" });
  });

  it("places after a collapsed task at its depth (its hidden subtasks stay with it)", () => {
    const items = outline("a", "b", "c"); // b's subtasks are collapsed, so not in the items
    expect(drop(items, "a", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null, beforeId: "c" });
  });

  it("puts a task at the end of the section above when dropped before a heading", () => {
    const items = outline("a", "# H", "b", "c");
    expect(drop(items, "c", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null, beforeId: "H" });
  });

  it("puts a task first in a section when dropped after its heading", () => {
    const items = outline("a", "b", "# H", "c");
    // Without a: [b, H, c], the gap after H.
    expect(drop(items, "a", { kind: "gap", index: 2, depth: 0 })).toEqual({ parentId: null, afterId: "H" });
  });

  it("puts a task first in a collapsed section when dropped after its heading", () => {
    const items = outline("a", "b", "# H", "# H2", "c"); // H is collapsed: no visible rows
    // Without a: [b, H, H2, c], the gap after H.
    expect(drop(items, "a", { kind: "gap", index: 2, depth: 0 })).toEqual({ parentId: null, afterId: "H" });
  });

  it("is null for the first task under a heading dropped back there", () => {
    const items = outline("a", "# H", "b", "c");
    // Without b: [a, H, c], the gap after H.
    expect(drop(items, "b", { kind: "gap", index: 2, depth: 0 })).toBeNull();
  });

  it("moves a task first under its heading from further down the section", () => {
    const items = outline("# H", "b", "c");
    expect(drop(items, "c", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null, afterId: "H" });
  });

  it("moves a task with subtasks", () => {
    const items = outline("a", "  b", "c");
    // Without a and b: [c], the end.
    expect(drop(items, "a", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null });
  });

  it("always sends the parent, null at the top level", () => {
    const items = outline("a", "  b", "c");
    const request = drop(items, "b", { kind: "gap", index: 2, depth: 0 });
    expect(request).toEqual({ parentId: null });
    expect(request).toHaveProperty("parentId", null);
  });

  it("is null where the task already is", () => {
    const items = outline("a", "b", "c");
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 0 })).toBeNull();
    expect(drop(items, "c", { kind: "gap", index: 2, depth: 0 })).toBeNull();
  });

  it("is null for a subtask dropped back in its place", () => {
    const items = outline("a", "  b", "  c", "d");
    // Without b: [a, c, d], the gap before c at depth 1.
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 1 })).toBeNull();
    // Without c: [a, b, d], the gap after b at depth 1.
    expect(drop(items, "c", { kind: "gap", index: 2, depth: 1 })).toBeNull();
  });

  it("is null for the last task before a heading dropped back there", () => {
    const items = outline("a", "b", "# H", "c");
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 0 })).toBeNull();
  });

  it("is not null when the task changes parent but keeps its next item", () => {
    const items = outline("a", "  b", "c");
    // Without b: [a, c]; at depth 0 before c it leaves a.
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null, beforeId: "c" });
  });

  it("is null for a depth no row can parent", () => {
    const items = outline("# H", "a", "b");
    expect(drop(items, "b", { kind: "gap", index: 1, depth: 1 })).toBeNull();
  });
});

describe("moveFor: into", () => {
  it("makes the task the last subtask", () => {
    const items = outline("a", "b", "c");
    expect(drop(items, "c", { kind: "into", taskId: "b" })).toEqual({ parentId: "b" });
  });

  it("goes after the target's subtasks", () => {
    const items = outline("a", "  b", "c");
    expect(drop(items, "c", { kind: "into", taskId: "a" })).toEqual({ parentId: "a" });
  });

  it("is null when the task is already the last subtask", () => {
    const items = outline("a", "  b", "  c");
    expect(drop(items, "c", { kind: "into", taskId: "a" })).toBeNull();
  });

  it("moves an earlier subtask to the end of its parent", () => {
    const items = outline("a", "  b", "  c");
    expect(drop(items, "b", { kind: "into", taskId: "a" })).toEqual({ parentId: "a" });
  });

  it("is null into the task itself or its subtasks", () => {
    const items = outline("a", "  b", "c");
    expect(drop(items, "a", { kind: "into", taskId: "a" })).toBeNull();
    expect(drop(items, "a", { kind: "into", taskId: "b" })).toBeNull();
  });

  it("is null into a heading, or for a dragged heading", () => {
    const items = outline("a", "# H", "b");
    expect(drop(items, "a", { kind: "into", taskId: "H" })).toBeNull();
    expect(drop(items, "H", { kind: "into", taskId: "a" })).toBeNull();
  });
});

describe("moveFor: headings", () => {
  const items = outline("a", "# H1", "b", "  c", "# H2", "d", "# H3", "e");
  // Without H1 and its section: [a, H2, d, H3, e]; heading gaps 1, 3 and 5.

  it("moves a heading with its section before another heading", () => {
    expect(drop(items, "H1", { kind: "gap", index: 3, depth: 0 })).toEqual({ parentId: null, beforeId: "H3", withSection: true });
  });

  it("moves a heading with its section to the end", () => {
    expect(drop(items, "H1", { kind: "gap", index: 5, depth: 0 })).toEqual({ parentId: null, withSection: true });
  });

  it("moves a later heading before the first one, after the leading rows", () => {
    // Without H3 and e: [a, H1, b, c, H2, d], the gap before H1.
    expect(drop(items, "H3", { kind: "gap", index: 1, depth: 0 })).toEqual({ parentId: null, beforeId: "H1", withSection: true });
  });

  it("is null for a gap that isn't between sections", () => {
    expect(drop(items, "H1", { kind: "gap", index: 0, depth: 0 })).toBeNull(); // above the leading row
    expect(drop(items, "H1", { kind: "gap", index: 2, depth: 0 })).toBeNull(); // inside H2's section
  });

  it("is null where the heading already is", () => {
    expect(drop(items, "H1", { kind: "gap", index: 1, depth: 0 })).toBeNull(); // before H2, where it was
    expect(drop(items, "H3", { kind: "gap", index: 6, depth: 0 })).toBeNull(); // the end, where it was
  });
});

describe("stepMove: subtasks", () => {
  const items = outline("a", "  b", "  c", "    x", "  d", "e");

  it("moves up past the previous sibling", () => {
    expect(stepMove(items, find(items, "c"), -1)).toEqual({ parentId: "a", beforeId: "b" });
  });

  it("moves down past the next sibling", () => {
    expect(stepMove(items, find(items, "b"), 1)).toEqual({ parentId: "a", beforeId: "d" });
  });

  it("moves down to the end past the last sibling", () => {
    expect(stepMove(items, find(items, "c"), 1)).toEqual({ parentId: "a" });
  });

  it("is null at either end of its siblings", () => {
    expect(stepMove(items, find(items, "b"), -1)).toBeNull();
    expect(stepMove(items, find(items, "d"), 1)).toBeNull();
    expect(stepMove(items, find(items, "x"), -1)).toBeNull();
    expect(stepMove(items, find(items, "x"), 1)).toBeNull();
  });
});

describe("stepMove: top-level tasks", () => {
  const items = outline("a", "  s", "b", "# H", "c", "d", "# H2");

  it("moves up past a row", () => {
    expect(stepMove(items, find(items, "b"), -1)).toEqual({ parentId: null, beforeId: "a" });
  });

  it("moves up past its heading to the end of the section above", () => {
    expect(stepMove(items, find(items, "c"), -1)).toEqual({ parentId: null, beforeId: "H" });
  });

  it("moves down past a row with subtasks", () => {
    expect(stepMove(items, find(items, "a"), 1)).toEqual({ parentId: null, beforeId: "H" });
  });

  it("moves down past a row", () => {
    expect(stepMove(items, find(items, "c"), 1)).toEqual({ parentId: null, beforeId: "H2" });
  });

  it("moves down past a heading to the start of its section", () => {
    expect(stepMove(items, find(items, "b"), 1)).toEqual({ parentId: null, afterId: "H" });
  });

  it("moves down past a heading with an empty section to the start of it", () => {
    expect(stepMove(items, find(items, "d"), 1)).toEqual({ parentId: null, afterId: "H2" });
  });

  it("moves down past a collapsed heading to the start of its section", () => {
    const collapsed = outline("a", "# H", "# H2", "c"); // H is collapsed: no visible rows
    expect(stepMove(collapsed, find(collapsed, "a"), 1)).toEqual({ parentId: null, afterId: "H" });
  });

  it("moves the first task under a heading up to the end of the section above", () => {
    const first = outline("a", "# H", "b");
    expect(stepMove(first, find(first, "b"), -1)).toEqual({ parentId: null, beforeId: "H" });
  });

  it("is null at the ends", () => {
    expect(stepMove(items, find(items, "a"), -1)).toBeNull();
    const end = outline("a", "b");
    expect(stepMove(end, find(end, "b"), 1)).toBeNull();
  });

  it("is null for a task not in the items", () => {
    expect(stepMove(items, task({ id: "z" }), 1)).toBeNull();
  });
});

describe("stepMove: headings", () => {
  const items = outline("a", "# H1", "b", "# H2", "c", "# H3");

  it("moves up past the previous section", () => {
    expect(stepMove(items, find(items, "H2"), -1)).toEqual({ parentId: null, beforeId: "H1", withSection: true });
  });

  it("doesn't move above the first heading's leading rows", () => {
    expect(stepMove(items, find(items, "H1"), -1)).toBeNull();
  });

  it("moves down past the next section", () => {
    expect(stepMove(items, find(items, "H1"), 1)).toEqual({ parentId: null, beforeId: "H3", withSection: true });
  });

  it("moves down past the last section to the end", () => {
    expect(stepMove(items, find(items, "H2"), 1)).toEqual({ parentId: null, withSection: true });
  });

  it("is null for the last heading going down", () => {
    expect(stepMove(items, find(items, "H3"), 1)).toBeNull();
  });
});

describe("indentMove", () => {
  it("makes a task the last subtask of the one above it at its depth, past that task's subtasks", () => {
    const items = outline("a", "  x", "b");
    expect(indentMove(items, find(items, "b"))).toEqual({ parentId: "a" });
  });
  it("works among subtasks", () => {
    const items = outline("a", "  x", "  y");
    expect(indentMove(items, find(items, "y"))).toEqual({ parentId: "x" });
  });
  it("gives null for the first task, the first subtask, a heading, and straight after a heading", () => {
    const items = outline("a", "  x", "# h", "b");
    expect(indentMove(items, find(items, "a"))).toBeNull();
    expect(indentMove(items, find(items, "x"))).toBeNull();
    expect(indentMove(items, find(items, "h"))).toBeNull();
    expect(indentMove(items, find(items, "b"))).toBeNull();
  });
  it("won't go under a completed task", () => {
    const items = outline("a", "b");
    items[0]!.task.completedAt = "2026-11-01T00:00:00.000Z";
    expect(indentMove(items, find(items, "b"))).toBeNull();
  });
});

describe("outdentMove", () => {
  it("puts a subtask straight after its parent at the parent's level", () => {
    const items = outline("a", "  x", "  y", "b");
    expect(outdentMove(items, find(items, "y"))).toEqual({ parentId: null, beforeId: "b" });
  });
  it("leaves the tasks below it under the old parent, and goes after them", () => {
    const items = outline("a", "  x", "  y", "b");
    expect(outdentMove(items, find(items, "x"))).toEqual({ parentId: null, beforeId: "b" });
  });
  it("goes last when nothing follows the parent", () => {
    const items = outline("a", "  x");
    expect(outdentMove(items, find(items, "x"))).toEqual({ parentId: null });
  });
  it("stays above a following heading", () => {
    const items = outline("a", "  x", "# h", "b");
    expect(outdentMove(items, find(items, "x"))).toEqual({ parentId: null, beforeId: "h" });
  });
  it("goes up one level from deep in", () => {
    const items = outline("a", "  x", "    d", "  y");
    expect(outdentMove(items, find(items, "d"))).toEqual({ parentId: "a", beforeId: "y" });
  });
  it("gives null at the top level and for a heading", () => {
    const items = outline("a", "# h");
    expect(outdentMove(items, find(items, "a"))).toBeNull();
    expect(outdentMove(items, find(items, "h"))).toBeNull();
  });
});
