/** One motion reading: acceleration in m/s², without gravity when the device can tell, and when it was taken (ms). */
export interface Motion { x: number; y: number; z: number; t: number; withGravity: boolean }

/** A jolt this hard (m/s²) counts as one swing of a shake. Walking and turning the phone stay well under it. */
export const JOLT = 14;
/** Swings needed within `WINDOW_MS` to make a shake, and the gap after one before the next can start. */
export const SWINGS = 3;
export const WINDOW_MS = 1000;
export const QUIET_MS = 1500;
/** Readings closer than this count as the same swing. */
const SWING_GAP_MS = 120;

/**
 * Feeds motion readings in, and says true once for each shake: three hard jolts within a second. With gravity removed
 * a jolt is the acceleration itself; with gravity in, it's the change from the reading before.
 */
export function createShakeDetector() {
  let swings: number[] = [];
  let previous: Motion | null = null;
  let quietUntil = -Infinity;
  return (m: Motion): boolean => {
    const base = m.withGravity ? previous : null;
    previous = m;
    if (m.withGravity && !base) return false;
    const [dx, dy, dz] = base ? [m.x - base.x, m.y - base.y, m.z - base.z] : [m.x, m.y, m.z];
    if (m.t < quietUntil || Math.hypot(dx, dy, dz) < JOLT) return false;
    if (swings.length && m.t - swings[swings.length - 1]! < SWING_GAP_MS) return false;
    swings = [...swings.filter((t) => m.t - t <= WINDOW_MS), m.t];
    if (swings.length < SWINGS) return false;
    swings = [];
    quietUntil = m.t + QUIET_MS;
    return true;
  };
}

type Xyz = { x: number | null; y: number | null; z: number | null } | null | undefined;

/** A `devicemotion` event as a Motion, preferring acceleration without gravity. Null when it has no readings. */
export function motionOf(e: { acceleration?: Xyz; accelerationIncludingGravity?: Xyz; timeStamp: number }): Motion | null {
  const pure = e.acceleration;
  if (pure && pure.x !== null && pure.y !== null && pure.z !== null) return { x: pure.x, y: pure.y, z: pure.z, t: e.timeStamp, withGravity: false };
  const g = e.accelerationIncludingGravity;
  if (g && g.x !== null && g.y !== null && g.z !== null) return { x: g.x, y: g.y, z: g.z, t: e.timeStamp, withGravity: true };
  return null;
}
