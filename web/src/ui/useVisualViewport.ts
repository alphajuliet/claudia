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

/** Whether a media query matches, following changes. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const update = (e: { matches: boolean }) => setMatches(e.matches);
    update(mq);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Whether the task panel is a full sheet rather than beside the list: the width where styles.css stops that. */
export const useSheet = () => useMedia("(max-width: 699.98px)");

/** Whether the compact touch layout applies, as its block in styles.css does. */
export const useCompact = () => useMedia("(pointer: coarse)");
