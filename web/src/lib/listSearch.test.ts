import { describe, expect, it } from "vitest";
import type { Folder, List } from "@claudia/shared";
import { listChoices, matchLists } from "./listSearch";

const folder = (id: string, name: string, parentId: string | null, position: string) =>
  ({ id, name, parentId, position, context: "work" }) as Folder;
const list = (id: string, name: string, folderId: string | null, position = "a0", archivedAt: string | null = null) =>
  ({ id, name, folderId, position, archivedAt, inbox: name === "Inbox" }) as List;

const folders = [folder("w", "🏢 Work", null, "a0"), folder("a", "Archive", "w", "a1"), folder("h", "🏡 Home", null, "a1")];
const lists = [
  list("in", "Inbox", null),
  list("g", "Garden", null, "a1"),
  list("t", "✈️ Travel & expenses", "w"),
  list("c", "Cuscal SPRM", "a"),
  list("r", "🛠️ Renovations", "h"),
  list("o", "Old stuff", "h", "a1", "2026-01-01T00:00:00.000Z"),
];
const choices = listChoices(folders, lists);
const names = (query: string) => matchLists(choices, query).map((c) => c.name);

describe("listChoices", () => {
  it("gives every live list in sidebar order, the Inbox first", () => {
    expect(choices.map((c) => c.id)).toEqual(["in", "g", "t", "c", "r"]);
  });
  it("sends the Inbox to its view, and the rest to their lists", () => {
    expect(choices[0]!.href).toBe("/inbox");
    expect(choices[1]!.href).toBe("/list/g");
  });
  it("gives each list's folder path", () => {
    expect(choices.map((c) => c.path)).toEqual(["", "", "🏢 Work", "🏢 Work › Archive", "🏡 Home"]);
  });
  it("copes without an Inbox", () => {
    expect(listChoices(folders, lists.filter((l) => l.id !== "in")).map((c) => c.id)).toEqual(["g", "t", "c", "r"]);
  });
});

describe("matchLists", () => {
  it("shows everything for an empty query", () => {
    expect(names("  ")).toHaveLength(5);
  });
  it("matches anywhere in the name, ignoring case and emoji", () => {
    expect(names("TRA")).toEqual(["✈️ Travel & expenses"]);
    expect(names("expen")).toEqual(["✈️ Travel & expenses"]);
    expect(names("sprm")).toEqual(["Cuscal SPRM"]);
  });
  it("ignores accents and punctuation", () => {
    expect(matchLists(listChoices([], [list("x", "Café & bar", null)]), "cafe bar")).toHaveLength(1);
  });
  it("needs every word, in any order", () => {
    expect(names("expenses travel")).toEqual(["✈️ Travel & expenses"]);
    expect(names("travel garden")).toEqual([]);
  });
  it("puts names that start with the query first, then words that do, then the rest", () => {
    const some = listChoices([], [list("1", "Bicycle", null, "a0"), list("2", "The cycle", null, "a1"), list("3", "Cycle", null, "a2")]);
    expect(matchLists(some, "cyc").map((c) => c.name)).toEqual(["Cycle", "The cycle", "Bicycle"]);
  });
  it("finds nothing for symbols alone, rather than everything", () => {
    expect(names("✈️")).toEqual([]);
  });
});
