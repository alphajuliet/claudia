/**
 * Row swipes, as pure state: a touch press starts `pending`; once it has moved past SLOP it is either `swiping`
 * (mostly horizontal) or `scrolling` (vertical first, and final). The outcome is decided when the finger lifts.
 */

export type SwipePhase = "idle" | "pending" | "scrolling" | "swiping";
export interface SwipeState { phase: SwipePhase; startX: number; startY: number; dx: number }

export const SLOP = 10; // px before a direction is decided
export const COMPLETE_AT = 0.4; // share of the row width
export const REVEAL_WIDTH = 144; // px of the Date and Snooze buttons
export const REVEAL_AT = 0.5; // share of REVEAL_WIDTH to stay open

export const start = (x: number, y: number): SwipeState => ({ phase: "pending", startX: x, startY: y, dx: 0 });

/** A move: decides the direction once past SLOP (mostly vertical → scrolling, which is final), then tracks dx. */
export function move(s: SwipeState, x: number, y: number, allowLeft: boolean): SwipeState {
  if (s.phase === "idle" || s.phase === "scrolling") return s;
  const dx = x - s.startX;
  const dy = y - s.startY;
  if (s.phase === "pending") {
    if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) return { ...s, phase: "swiping", dx: clamp(dx, allowLeft) };
    if (Math.abs(dy) > SLOP) return { ...s, phase: "scrolling" };
    return s;
  }
  return { ...s, dx: clamp(dx, allowLeft) };
}

const clamp = (dx: number, allowLeft: boolean) => (allowLeft ? dx : Math.max(0, dx));

/** The outcome when the finger lifts. */
export function end(s: SwipeState, width: number): "complete" | "reveal" | "cancel" {
  if (s.phase !== "swiping") return "cancel";
  if (s.dx >= width * COMPLETE_AT) return "complete";
  if (s.dx <= -REVEAL_WIDTH * REVEAL_AT) return "reveal";
  return "cancel";
}
