import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands";
import { createMatcher, ignoresKeys, wrapIndex } from "./keymap";

describe("createMatcher", () => {
  it("matches single keys, including arrows", () => {
    const m = createMatcher(COMMANDS);
    expect(m.match("j", 0)).toBe("next");
    expect(m.match("ArrowUp", 0)).toBe("previous");
    expect(m.match("?", 0)).toBe("help");
    expect(m.match("q", 0)).toBeNull();
  });

  it("matches a chord typed within the time limit", () => {
    const m = createMatcher(COMMANDS);
    expect(m.match("g", 1000)).toBe("pending");
    expect(m.match("t", 2400)).toBe("goToday");
    expect(m.match("j", 2500)).toBe("next");
  });

  it("cancels a chord on an unknown second key without running that key", () => {
    const m = createMatcher(COMMANDS);
    expect(m.match("g", 0)).toBe("pending");
    expect(m.match("j", 10)).toBeNull();
    expect(m.match("j", 20)).toBe("next");
  });

  it("forgets a chord on reset", () => {
    const m = createMatcher(COMMANDS);
    expect(m.match("g", 0)).toBe("pending");
    m.reset();
    expect(m.match("t", 10)).toBeNull();
  });

  it("forgets a chord after the time limit and matches the key alone", () => {
    const m = createMatcher(COMMANDS);
    expect(m.match("g", 0)).toBe("pending");
    expect(m.match("x", 1501)).toBe("complete");
    expect(m.match("g", 2000)).toBe("pending");
    expect(m.match("g", 5000)).toBe("pending");
    expect(m.match("i", 5100)).toBe("goInbox");
  });
});

describe("ignoresKeys", () => {
  const press = (target: EventTarget | null, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    ignoresKeys({ ctrlKey: false, metaKey: false, altKey: false, target, ...mods });
  const el = (tag: string, props: { type?: string } = {}): HTMLElement => Object.assign(document.createElement(tag), props);

  it("ignores keys with Ctrl, ⌘ or Alt", () => {
    expect(press(document.body, { metaKey: true })).toBe(true);
    expect(press(document.body, { ctrlKey: true })).toBe(true);
    expect(press(document.body, { altKey: true })).toBe(true);
    expect(press(document.body)).toBe(false);
  });

  it("ignores keys typed in text fields but not on checkboxes or buttons", () => {
    expect(press(el("input"))).toBe(true);
    expect(press(el("input", { type: "search" }))).toBe(true);
    expect(press(el("input", { type: "date" }))).toBe(true);
    expect(press(el("textarea"))).toBe(true);
    expect(press(el("select"))).toBe(true);
    expect(press(el("input", { type: "checkbox" }))).toBe(false);
    expect(press(el("button"))).toBe(false);
    expect(press(el("li"))).toBe(false);
    expect(press(null)).toBe(false);
  });

  it("ignores keys in editable content", () => {
    const div = el("div");
    // jsdom doesn't compute isContentEditable from the attribute.
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(press(div)).toBe(true);
  });
});

describe("wrapIndex", () => {
  it("starts at the first or last row when there's no highlight", () => {
    expect(wrapIndex(-1, 3, 1)).toBe(0);
    expect(wrapIndex(-1, 3, -1)).toBe(2);
  });

  it("wraps at both ends", () => {
    expect(wrapIndex(2, 3, 1)).toBe(0);
    expect(wrapIndex(0, 3, -1)).toBe(2);
    expect(wrapIndex(1, 3, 1)).toBe(2);
  });

  it("has nothing to move to in an empty list", () => {
    expect(wrapIndex(-1, 0, 1)).toBe(-1);
    expect(wrapIndex(0, 0, -1)).toBe(-1);
  });
});
