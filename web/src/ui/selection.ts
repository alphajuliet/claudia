import { useLocation, useSearch } from "wouter";

/**
 * The selected task lives in the address as `?task=<id>`, on whatever path is showing, so reload and back keep it.
 * `select(null)` removes it.
 */
export function useSelectedTask(): { selectedId: string | null; select: (id: string | null) => void } {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const selectedId = params.get("task");
  const select = (id: string | null) => {
    if (id === selectedId) return;
    const next = new URLSearchParams(search);
    if (id) next.set("task", id);
    else next.delete("task");
    const query = next.toString();
    navigate(query ? `${path}?${query}` : path);
  };
  return { selectedId, select };
}
