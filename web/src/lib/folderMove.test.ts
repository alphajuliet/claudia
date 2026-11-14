import { describe, expect, it } from "vitest";
import type { Folder } from "@claudia/shared";
import { folderMoveForDrop, folderPosition } from "./folderMove";

const folder = (id: string, parentId: string | null, position: string): Folder =>
  ({ id, name: id, parentId, context: "work", position, createdAt: "", updatedAt: "" }) as Folder;
// Top level: A, B, C. Under A: A1, A2. Under A1: A1x.
const folders = [
  folder("A", null, "a0"), folder("B", null, "a1"), folder("C", null, "a2"),
  folder("A1", "A", "a0"), folder("A2", "A", "a1"), folder("A1x", "A1", "a0"),
];
const plan = (id: string, drop: Parameters<typeof folderMoveForDrop>[2]) => folderMoveForDrop(folders, id, drop);

describe("folderMoveForDrop", () => {
  it("places a folder before or after a sibling", () => {
    expect(plan("C", { kind: "before", folderId: "A" })).toEqual({ parentId: null, beforeId: "A" });
    expect(plan("A", { kind: "after", folderId: "B" })).toEqual({ parentId: null, beforeId: "C" });
    expect(plan("A", { kind: "after", folderId: "C" })).toEqual({ parentId: null });
  });

  it("moves beside a folder at another level", () => {
    expect(plan("C", { kind: "before", folderId: "A2" })).toEqual({ parentId: "A", beforeId: "A2" });
    expect(plan("A1x", { kind: "after", folderId: "B" })).toEqual({ parentId: null, beforeId: "C" });
  });

  it("puts a folder last in a folder, or first with atStart, and at the top level for null", () => {
    expect(plan("B", { kind: "into", folderId: "A" })).toEqual({ parentId: "A" });
    expect(plan("B", { kind: "into", folderId: "A", atStart: true })).toEqual({ parentId: "A", beforeId: "A1" });
    expect(plan("B", { kind: "into", folderId: "C" })).toEqual({ parentId: "C" });
    expect(plan("A1x", { kind: "into", folderId: null })).toEqual({ parentId: null });
    expect(plan("A1x", { kind: "into", folderId: null, atStart: true })).toEqual({ parentId: null, beforeId: "A" });
  });

  it("sends nothing for a drop where it already is", () => {
    expect(plan("B", { kind: "before", folderId: "B" })).toBeNull();
    expect(plan("B", { kind: "after", folderId: "A" })).toBeNull();
    expect(plan("B", { kind: "before", folderId: "C" })).toBeNull();
    expect(plan("A2", { kind: "into", folderId: "A" })).toBeNull();
    expect(plan("A1", { kind: "into", folderId: "A", atStart: true })).toBeNull();
    expect(plan("C", { kind: "into", folderId: null })).toBeNull();
  });

  it("won't put a folder inside itself or under it", () => {
    expect(plan("A", { kind: "into", folderId: "A" })).toBeNull();
    expect(plan("A", { kind: "into", folderId: "A1x" })).toBeNull();
    expect(plan("A", { kind: "before", folderId: "A1x" })).toBeNull();
    expect(plan("A1", { kind: "after", folderId: "A1x" })).toBeNull();
  });

  it("gives null for a folder that isn't known", () => {
    expect(plan("nope", { kind: "into", folderId: null })).toBeNull();
    expect(plan("A", { kind: "before", folderId: "nope" })).toBeNull();
  });
});

describe("folderPosition", () => {
  it("works out the position between the new neighbours", () => {
    const p = folderPosition(folders, "C", { parentId: null, beforeId: "A" })!;
    expect(p < "a0").toBe(true);
    const q = folderPosition(folders, "B", { parentId: "A" })!;
    expect(q > "a1").toBe(true);
  });

  it("gives null for an anchor that isn't a sibling", () => {
    expect(folderPosition(folders, "C", { parentId: null, beforeId: "A2" })).toBeNull();
  });
});
