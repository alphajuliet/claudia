import type { Filter, Folder, List } from "@claudia/shared";
import { describe, expect, it } from "vitest";
import { filterMoveForDrop } from "./filterMove";
import { listOrder, sidebarTree } from "./sidebar";

const stamp = "2026-10-01T00:00:00.000Z";
const folder = (id: string, position: string, context: Folder["context"], parentId: string | null = null): Folder => ({
  id,
  name: id,
  parentId,
  context,
  position,
  createdAt: stamp,
  updatedAt: stamp,
});
const list = (id: string, position: string, folderId: string | null, archivedAt: string | null = null): List => ({
  id,
  name: id,
  folderId,
  inbox: false,
  position,
  archivedAt,
  createdAt: stamp,
  updatedAt: stamp,
});

const view = (id: string, position: string, folderId: string | null): Filter => ({
  id, name: id, query: "", sort: null, group: null, display: {}, folderId, position, createdAt: stamp, updatedAt: stamp,
});

const folders = [
  folder("Home", "a1", "home"),
  folder("Work", "a0", "work"),
  folder("Projects", "a0", "work", "Work"),
  folder("Garden", "a0", "personal", "Home"),
];
const lists = [
  list("Inbox", "a0", null),
  list("Scratch", "Zz", null),
  list("Admin", "a1", "Work"),
  list("Meetings", "a0", "Work"),
  list("Old", "a2", "Work", stamp),
  list("Alpha", "a0", "Projects"),
  list("Chores", "a0", "Home"),
  list("Beds", "a0", "Garden"),
];

describe("sidebarTree", () => {
  it("nests folders and lists in position order without archived lists", () => {
    const tree = sidebarTree(folders, lists, "all");
    expect(tree.lists.map((l) => l.id)).toEqual(["Scratch", "Inbox"]);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["Work", "Home"]);
    const work = tree.folders[0]!;
    expect(work.lists.map((l) => l.id)).toEqual(["Meetings", "Admin"]);
    expect(work.folders.map((n) => n.folder.id)).toEqual(["Projects"]);
    expect(work.folders[0]!.lists.map((l) => l.id)).toEqual(["Alpha"]);
    expect(tree.folders[1]!.folders[0]!.lists.map((l) => l.id)).toEqual(["Beds"]);
  });

  it("drops folders outside the context but keeps unfiled lists", () => {
    const tree = sidebarTree([...folders, folder("Me", "a2", "personal")], [...lists, list("Diary", "a0", "Me")], "work");
    expect(tree.lists.map((l) => l.id)).toEqual(["Scratch", "Inbox"]);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["Work"]);
  });
});

describe("smart views in the tree", () => {
  const views = [view("Soon", "a1", null), view("Due", "a0", null), view("Desk", "a1", "Work"), view("Calls", "a0", "Work"), view("Beds", "a0", "Garden")];

  it("sit outside folders or in them, in position order, and leave with their folder's context", () => {
    const tree = sidebarTree(folders, lists, "all", views);
    expect(tree.filters.map((f) => f.id)).toEqual(["Due", "Soon"]);
    expect(tree.folders[0]!.filters.map((f) => f.id)).toEqual(["Calls", "Desk"]);
    expect(tree.folders[1]!.folders[0]!.filters.map((f) => f.id)).toEqual(["Beds"]);
    const work = sidebarTree(folders, lists, "work", views);
    expect(work.filters.map((f) => f.id)).toEqual(["Due", "Soon"]);
    expect(work.folders.flatMap((n) => n.filters.map((f) => f.id))).toEqual(["Calls", "Desk"]);
  });

  it("move beside another smart view, or last into a folder, and not when nothing would change", () => {
    const tree = sidebarTree(folders, lists, "all", views);
    expect(filterMoveForDrop(tree, "Soon", { kind: "before", filterId: "Desk" })).toEqual({ folderId: "Work", beforeId: "Desk" });
    expect(filterMoveForDrop(tree, "Soon", { kind: "after", filterId: "Desk" })).toEqual({ folderId: "Work" });
    expect(filterMoveForDrop(tree, "Desk", { kind: "into", folderId: null })).toEqual({ folderId: null });
    expect(filterMoveForDrop(tree, "Soon", { kind: "into", folderId: "Projects" })).toEqual({ folderId: "Projects" });
    expect(filterMoveForDrop(tree, "Due", { kind: "before", filterId: "Soon" })).toBeNull();
    expect(filterMoveForDrop(tree, "Soon", { kind: "into", folderId: null })).toBeNull();
    expect(filterMoveForDrop(tree, "Soon", { kind: "before", filterId: "Due" })).toEqual({ folderId: null, beforeId: "Due" });
  });
});

describe("listOrder", () => {
  it("gives unfiled lists, then each folder's lists before its subfolders", () => {
    expect(listOrder(sidebarTree(folders, lists, "all"))).toEqual([
      "Scratch",
      "Inbox",
      "Meetings",
      "Admin",
      "Alpha",
      "Chores",
      "Beds",
    ]);
  });
});
