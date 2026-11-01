import { describe, expect, it } from "vitest";
import type { List } from "@claudia/shared";
import { listPosition, moveForDrop, moveForStep } from "./listMove";
import type { FolderNode, SidebarTree } from "./sidebar";

const list = (id: string, folderId: string | null, position: string): List =>
  ({ id, name: id, folderId, position, archivedAt: null, createdAt: "", updatedAt: "" }) as List;
const a = list("a", null, "a0"), b = list("b", null, "a1"), c = list("c", null, "a2");
const x = list("x", "f", "a0"), y = list("y", "f", "a1");
const z = list("z", "g", "a0");
const node = (id: string, lists: List[], folders: FolderNode[] = []) => ({ folder: { id } as FolderNode["folder"], lists, folders });
const tree: SidebarTree = { lists: [a, b, c], folders: [node("f", [x, y], [node("g", [z])]), node("h", [])] };

describe("moveForDrop", () => {
  it("places a list before or after another in its group", () => {
    expect(moveForDrop(tree, "c", { kind: "before", listId: "a" })).toEqual({ folderId: null, beforeId: "a" });
    expect(moveForDrop(tree, "a", { kind: "after", listId: "b" })).toEqual({ folderId: null, beforeId: "c" });
    expect(moveForDrop(tree, "a", { kind: "after", listId: "c" })).toEqual({ folderId: null });
  });
  it("sends nothing for a drop where it already is", () => {
    expect(moveForDrop(tree, "b", { kind: "before", listId: "b" })).toBeNull();
    expect(moveForDrop(tree, "b", { kind: "after", listId: "b" })).toBeNull();
    expect(moveForDrop(tree, "b", { kind: "after", listId: "a" })).toBeNull();
    expect(moveForDrop(tree, "b", { kind: "before", listId: "c" })).toBeNull();
  });
  it("moves a list to another folder beside a list there", () => {
    expect(moveForDrop(tree, "a", { kind: "before", listId: "y" })).toEqual({ folderId: "f", beforeId: "y" });
    expect(moveForDrop(tree, "x", { kind: "after", listId: "c" })).toEqual({ folderId: null });
  });
  it("puts a list last in a folder dropped on, and first among the unfiled lists on the heading", () => {
    expect(moveForDrop(tree, "a", { kind: "folder", folderId: "h" })).toEqual({ folderId: "h" });
    expect(moveForDrop(tree, "x", { kind: "folder", folderId: "f" })).toEqual({ folderId: "f" });
    expect(moveForDrop(tree, "y", { kind: "folder", folderId: "f" })).toBeNull();
    expect(moveForDrop(tree, "x", { kind: "folder", folderId: null })).toEqual({ folderId: null, beforeId: "a" });
    expect(moveForDrop(tree, "a", { kind: "folder", folderId: null })).toBeNull();
  });
  it("gives null for a list that isn't shown", () => {
    expect(moveForDrop(tree, "nope", { kind: "before", listId: "a" })).toBeNull();
    expect(moveForDrop(tree, "a", { kind: "before", listId: "nope" })).toBeNull();
  });
});

describe("moveForStep", () => {
  it("steps past a neighbour", () => {
    expect(moveForStep(tree, "b", -1)).toEqual({ folderId: null, beforeId: "a" });
    expect(moveForStep(tree, "a", 1)).toEqual({ folderId: null, afterId: "b" });
  });
  it("crosses into the next or previous group, as the sidebar shows them", () => {
    expect(moveForStep(tree, "c", 1)).toEqual({ folderId: "f", beforeId: "x" });
    expect(moveForStep(tree, "x", -1)).toEqual({ folderId: null });
    expect(moveForStep(tree, "y", 1)).toEqual({ folderId: "g", beforeId: "z" });
    expect(moveForStep(tree, "z", 1)).toEqual({ folderId: "h" });
  });
  it("stops at the ends", () => {
    expect(moveForStep(tree, "a", -1)).toBeNull();
    expect(moveForStep({ lists: [a], folders: [] }, "a", 1)).toBeNull();
  });
});

describe("listPosition", () => {
  it("sorts the list where the move says", () => {
    const all = [a, b, c];
    const at = (move: Parameters<typeof listPosition>[2]) => listPosition(all, "c", move)!;
    expect(at({ folderId: null, beforeId: "a" }) < "a0").toBe(true);
    const between = at({ folderId: null, afterId: "a" });
    expect(between > "a0" && between < "a1").toBe(true);
    expect(listPosition(all, "a", { folderId: null })! > "a2").toBe(true);
  });
  it("gives null when the neighbours can't be placed between", () => {
    expect(listPosition([a, list("same", null, "a0"), c], "c", { folderId: null, afterId: "a" })).toBeNull();
    expect(listPosition([a, c], "c", { folderId: null, beforeId: "gone" })).toBeNull();
  });
});
