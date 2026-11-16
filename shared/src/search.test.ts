import { describe, expect, it } from "vitest";
import { formatGroup, formatSort, parseGroup, parseSort } from "./search";

describe("parseSort", () => {
  it("reads a key with an optional direction", () => {
    expect(parseSort("due")).toEqual({ by: "due", desc: false });
    expect(parseSort("due-asc")).toEqual({ by: "due", desc: false });
    expect(parseSort("Due-DESC")).toEqual({ by: "due", desc: true });
  });

  it("rejects what it doesn't know", () => {
    expect(parseSort("colour")).toBeNull();
    expect(parseSort("-due")).toBeNull();
    expect(parseSort("due-up")).toBeNull();
    expect(parseSort("")).toBeNull();
  });

  it("formats back", () => {
    expect(formatSort({ by: "title", desc: true })).toBe("title-desc");
    expect(formatSort({ by: "title", desc: false })).toBe("title");
  });
});

describe("parseGroup", () => {
  it("reads a key, and labels for label", () => {
    expect(parseGroup("due")).toEqual({ by: "due" });
    expect(parseGroup("label")).toEqual({ by: "label" });
    expect(parseGroup("label:wip, next,waitingOn")).toEqual({ by: "label", labels: ["wip", "next", "waitingOn"] });
  });

  it("rejects what it doesn't know", () => {
    expect(parseGroup("colour")).toBeNull();
    expect(parseGroup("due:wip")).toBeNull();
    expect(parseGroup("label:")).toBeNull();
    expect(parseGroup("label:a:b")).toBeNull();
  });

  it("formats back", () => {
    expect(formatGroup({ by: "label", labels: ["wip", "next"] })).toBe("label:wip,next");
    expect(formatGroup({ by: "none" })).toBe("none");
  });
});
