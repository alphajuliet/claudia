/**
 * How search results are sorted and grouped, as written in a query (`sort:due-desc`, `group:"label:wip,next"`) or an
 * address (`?sort=due-desc&group=label:wip,next`). Shared so the server, the web app and MCP read them the same way.
 */

/** `list` is the default: priority first, then the lists' sidebar order and each task's position. */
export const SEARCH_SORTS = ["list", "priority", "due", "start", "created", "updated", "title"] as const;
export type SearchSortKey = (typeof SEARCH_SORTS)[number];
export interface SearchSort { by: SearchSortKey; desc: boolean }

/**
 * `list` is the default. `due` uses the views' buckets (Overdue, Today, …). `status` groups by status label, in the
 * status labels' order, with No status last.
 */
export const SEARCH_GROUPS = ["list", "due", "label", "status", "none"] as const;
export type SearchGroupKey = (typeof SEARCH_GROUPS)[number];
/** For `label`, `labels` puts those groups first, in that order. */
export interface SearchGroup { by: SearchGroupKey; labels?: string[] }

export const DEFAULT_SORT: SearchSort = { by: "list", desc: false };
export const DEFAULT_GROUP: SearchGroup = { by: "list" };

/** `due`, `due-asc` or `due-desc`; null if it isn't one. */
export function parseSort(text: string): SearchSort | null {
  const m = /^([a-z]+)(?:-(asc|desc))?$/.exec(text.trim().toLowerCase());
  if (!m || !(SEARCH_SORTS as readonly string[]).includes(m[1]!)) return null;
  return { by: m[1] as SearchSortKey, desc: m[2] === "desc" };
}

export const formatSort = (s: SearchSort) => (s.desc ? `${s.by}-desc` : s.by);

/** `list`, `due`, `status`, `none`, `label` or `label:a,b`; null if it isn't one. */
export function parseGroup(text: string): SearchGroup | null {
  const [head, rest, ...more] = text.trim().split(":");
  const by = head!.toLowerCase();
  if (more.length || !(SEARCH_GROUPS as readonly string[]).includes(by)) return null;
  if (rest === undefined) return { by: by as SearchGroupKey };
  if (by !== "label") return null;
  const labels = rest.split(",").map((l) => l.trim()).filter(Boolean);
  return labels.length ? { by: "label", labels } : null;
}

export const formatGroup = (g: SearchGroup) => (g.labels?.length ? `${g.by}:${g.labels.join(",")}` : g.by);
