import { useLocation, useSearch } from "wouter";

/** The task the panel last switched to by following the keyboard highlight: that panel leaves focus on the row. */
let followedId: string | null = null;

/** Whether the panel for `id` was opened by following the highlight (it shouldn't take focus). */
export const wasFollowed = (id: string) => followedId === id;

/**
 * The selected task lives in the address as `?task=<id>`, on whatever path is showing, so reload and back keep it.
 * `select(null)` removes it. With `follow` (the panel following the keyboard highlight), the address is replaced
 * rather than added to, so Back doesn't step through every task passed.
 */
export function useSelectedTask(): { selectedId: string | null; select: (id: string | null, opts?: { follow?: boolean }) => void } {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const selectedId = params.get("task");
  const select = (id: string | null, opts: { follow?: boolean } = {}) => {
    if (id === selectedId) return;
    const next = new URLSearchParams(search);
    if (id) next.set("task", id);
    else next.delete("task");
    const query = next.toString();
    followedId = opts.follow ? id : null;
    navigate(query ? `${path}?${query}` : path, { replace: Boolean(opts.follow) });
  };
  return { selectedId, select };
}
