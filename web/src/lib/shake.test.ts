import { describe, expect, it } from "vitest";
import { createShakeDetector, motionOf, QUIET_MS, type Motion } from "./shake";

const pure = (x: number, t: number): Motion => ({ x, y: 0, z: 0, t, withGravity: false });

describe("createShakeDetector", () => {
  it("says true on the third hard swing within a second, once", () => {
    const shake = createShakeDetector();
    expect([pure(20, 0), pure(-20, 200), pure(20, 400)].map(shake)).toEqual([false, false, true]);
    expect(shake(pure(-20, 600))).toBe(false);
  });

  it("ignores gentle movement, swings too far apart and readings of the same swing", () => {
    const gentle = createShakeDetector();
    expect([pure(5, 0), pure(-8, 200), pure(9, 400), pure(-10, 600)].some(gentle)).toBe(false);
    const slow = createShakeDetector();
    expect([pure(20, 0), pure(-20, 700), pure(20, 1400), pure(-20, 2100)].some(slow)).toBe(false);
    const oneSwing = createShakeDetector();
    expect([pure(20, 0), pure(22, 30), pure(25, 60)].some(oneSwing)).toBe(false);
  });

  it("waits a moment before the next shake", () => {
    const shake = createShakeDetector();
    [pure(20, 0), pure(-20, 200), pure(20, 400)].forEach(shake);
    expect([pure(20, 600), pure(-20, 800), pure(20, 1000)].some(shake)).toBe(false);
    const t = 400 + QUIET_MS;
    expect([pure(20, t), pure(-20, t + 200), pure(20, t + 400)].map(shake)).toEqual([false, false, true]);
  });

  it("reads jolts as changes when gravity is included, so holding the phone still is no shake", () => {
    const shake = createShakeDetector();
    const g = (z: number, t: number): Motion => ({ x: 0, y: 0, z, t, withGravity: true });
    expect([g(9.8, 0), g(9.8, 200), g(9.8, 400), g(9.8, 600)].some(shake)).toBe(false);
    expect([g(-8, 800), g(9.8, 1000), g(-8, 1200)].map(shake)).toEqual([false, false, true]);
  });
});

describe("motionOf", () => {
  it("prefers acceleration without gravity, and falls back to with gravity", () => {
    expect(motionOf({ acceleration: { x: 1, y: 2, z: 3 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, timeStamp: 5 }))
      .toEqual({ x: 1, y: 2, z: 3, t: 5, withGravity: false });
    expect(motionOf({ acceleration: { x: null, y: null, z: null }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, timeStamp: 5 }))
      .toEqual({ x: 0, y: 0, z: 9.8, t: 5, withGravity: true });
    expect(motionOf({ timeStamp: 5 })).toBeNull();
  });
});
