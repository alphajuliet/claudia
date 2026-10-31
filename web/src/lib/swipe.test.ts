import { describe, expect, it } from "vitest";
import { COMPLETE_AT, end, move, REVEAL_AT, REVEAL_WIDTH, SLOP, start } from "./swipe";

describe("swipe recognition", () => {
  it("starts pending at the press", () => {
    expect(start(10, 20)).toEqual({ phase: "pending", startX: 10, startY: 20, dx: 0 });
  });

  it("stays pending within the slop", () => {
    const s = move(start(0, 0), SLOP, SLOP, true);
    expect(s.phase).toBe("pending");
    expect(end(s, 320)).toBe("cancel");
  });

  it("swipes once the movement is past the slop and mostly horizontal", () => {
    const s = move(start(100, 100), 100 + SLOP + 1, 105, true);
    expect(s.phase).toBe("swiping");
    expect(s.dx).toBe(SLOP + 1);
    expect(move(s, 180, 160, true)).toMatchObject({ phase: "swiping", dx: 80 });
  });

  it("doesn't swipe when the movement is past the slop but mostly vertical", () => {
    expect(move(start(0, 0), 12, 14, true).phase).toBe("scrolling");
  });

  it("scrolls once vertical movement passes the slop first, and never swipes after", () => {
    let s = move(start(0, 0), 2, SLOP + 1, true);
    expect(s.phase).toBe("scrolling");
    s = move(s, 200, SLOP + 1, true);
    expect(s).toMatchObject({ phase: "scrolling", dx: 0 });
    expect(end(s, 320)).toBe("cancel");
  });

  it("clamps a leftward movement at 0 unless left is allowed", () => {
    const s = move(start(100, 0), 70, 0, false);
    expect(s.phase).toBe("swiping");
    expect(s.dx).toBe(0);
    expect(move(s, 40, 0, false).dx).toBe(0);
    expect(move(s, 150, 0, false).dx).toBe(50);
    expect(move(start(100, 0), 70, 0, true).dx).toBe(-30);
  });

  it("completes past the share of the row width", () => {
    const at = 320 * COMPLETE_AT;
    expect(end(move(start(0, 0), at, 0, true), 320)).toBe("complete");
    expect(end(move(start(0, 0), at - 1, 0, true), 320)).toBe("cancel");
  });

  it("reveals past half the buttons' width to the left", () => {
    const at = -REVEAL_WIDTH * REVEAL_AT;
    expect(end(move(start(200, 0), 200 + at, 0, true), 320)).toBe("reveal");
    expect(end(move(start(200, 0), 200 + at + 1, 0, true), 320)).toBe("cancel");
  });

  it("cancels when nothing was decided", () => {
    expect(end(start(0, 0), 320)).toBe("cancel");
  });
});
