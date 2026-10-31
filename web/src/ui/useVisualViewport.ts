import { useEffect, useState } from "react";

export type ViewportSize = { height: number; offsetTop: number };

const read = (vv: VisualViewport): ViewportSize => ({ height: vv.height, offsetTop: vv.offsetTop });

/**
 * The visible part of the layout viewport (what the on-screen keyboard leaves showing), kept up to date as it
 * resizes or scrolls. Null where the browser has no `visualViewport`.
 */
export function useVisualViewport(): ViewportSize | null {
  const [size, setSize] = useState<ViewportSize | null>(() => (window.visualViewport ? read(window.visualViewport) : null));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setSize(read(vv));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return size;
}

const narrowQuery = "(max-width: 899.98px)";

/** Whether the narrow (phone) layout applies, following changes to the window's width. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(narrowQuery).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(narrowQuery);
    const update = (e: { matches: boolean }) => setNarrow(e.matches);
    update(mq);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}
