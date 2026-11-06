import { useEffect, useState } from "react";
import { createShakeDetector, motionOf } from "../lib/shake";
import { useCommand } from "./keyboard";
import { useToast } from "./Toast";

const KEY = "claudia.shakeToUndo";

type MotionPermission = "granted" | "denied";
/** iOS 13+ asks before a page may read motion; other browsers just send the events. */
const askable = () =>
  (globalThis.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<MotionPermission> } | undefined)?.requestPermission;

/** The device can report motion and has a touch screen, so the switch is worth showing. */
export const canShake = () =>
  typeof window !== "undefined" && "DeviceMotionEvent" in window && (window.matchMedia?.("(pointer: coarse)").matches ?? false);

function saved(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}
function save(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch { /* on until the page reloads */ }
}

/** Asks iOS for motion access (only from a tap); true when there's nothing to ask or it's allowed. */
async function allowMotion(): Promise<boolean> {
  const ask = askable();
  if (!ask) return true;
  try { return (await ask.call(globalThis.DeviceMotionEvent)) === "granted"; } catch { return false; }
}

/**
 * The "Shake to undo" setting, kept in this browser (motion access belongs to the device). Turning it on asks for
 * motion access first, and stays off if that's refused.
 */
export function useShakeSetting(): [boolean, (on: boolean) => Promise<boolean>] {
  const [on, setOn] = useState(saved);
  useEffect(() => {
    const sync = () => setOn(saved());
    window.addEventListener("claudia:shake-setting", sync);
    return () => window.removeEventListener("claudia:shake-setting", sync);
  }, []);
  return [on, async (next) => {
    if (next && !(await allowMotion())) return false;
    save(next);
    setOn(next);
    window.dispatchEvent(new Event("claudia:shake-setting"));
    return true;
  }];
}

/**
 * Undo: `z`, or shaking the phone with the setting on. A shake asks first, naming the change, as iOS does; `z` just
 * undoes. Either says so when there's nothing to undo. iOS may forget motion access between launches, so with the
 * setting on the first tap of a session asks again (without a prompt when it's still allowed).
 */
export function UndoCommands() {
  const toast = useToast();
  const [on] = useShakeSetting();
  const nothing = () => toast.show({ message: "Nothing to undo" });
  useCommand("undo", () => { if (!toast.undo()) nothing(); });

  useEffect(() => {
    if (!on) return;
    const shaken = createShakeDetector();
    const onMotion = (e: Event) => {
      const m = motionOf(e as DeviceMotionEvent);
      if (!m || !shaken(m)) return;
      const last = toast.lastUndo();
      if (!last) return nothing();
      if (window.confirm(`Undo this?\n\n${last.message}`)) toast.undo();
    };
    window.addEventListener("devicemotion", onMotion);
    const reask = () => void allowMotion();
    if (askable()) window.addEventListener("click", reask, { once: true, capture: true });
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("click", reask, { capture: true });
    };
  }, [on]);
  return null;
}
