import type { Folder, List } from "@claudia/shared";
import { describe, expect, it } from "vitest";
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
  position,
  archivedAt,
  createdAt: stamp,
  updatedAt: stamp,
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
