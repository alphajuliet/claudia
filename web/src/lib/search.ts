import type { List, SearchGroup, SearchSort, Task } from "@claudia/shared";
import { byPriority, dueDateOf, groupByDue, groupByList, type Row } from "./tasks";

export interface SearchSection { key: string; title?: string; rows: Row[] }

interface Context {
  lists: List[];
  /** List ids in sidebar order. */
  listOrder: string[];
  today: string;
  timeZone: string;
  /** The status labels' names, in order, for grouping by status. */
  status?: string[];
}

const isDefault = (sort: SearchSort) => sort.by === "list" && !sort.desc;

/**
 * Orders tasks by a search sort: its key (missing values last, whichever way), then priority, the list's sidebar
 * place and position. Due goes by day in the time zone, then due time.
 */
export function searchComparator(sort: SearchSort, ctx: Pick<Context, "listOrder" | "timeZone">): (a: Task, b: Task) => number {
  const rank = new Map(ctx.listOrder.map((id, i) => [id, i]));
  const tail = (a: Task, b: Task) =>
    (rank.get(a.listId) ?? Infinity) - (rank.get(b.listId) ?? Infinity) || (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);
  const sign = sort.desc ? -1 : 1;
  const compare = (x: string | null, y: string | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : sign * (x < y ? -1 : 1));
  const key = (t: Task): (string | null)[] => {
    switch (sort.by) {
      case "due": return [dueDateOf(t, ctx.timeZone), t.dueAt];
      case "start": return [t.startDate];
      case "created": return [t.createdAt];
      case "updated": return [t.updatedAt];
      case "title": return [t.title.toLowerCase()];
      default: return [];
    }
  };
  if (sort.by === "list" || sort.by === "priority") return (a, b) => sign * byPriority(a, b) || tail(a, b);
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const c = compare(ka[i]!, kb[i]!);
      if (c) return c;
    }
    return byPriority(a, b) || tail(a, b);
  };
}

const flat = (tasks: Task[]): Row[] => tasks.map((task) => ({ task, depth: 0 }));

/**
 * Search results as sections. By list: in sidebar order, each in outline order by priority, or flat in the sort if
 * one is chosen. By due: the views' buckets. By label: each task once, under its first label in the given order (then
 * alphabetical), with "No label" last. By status: each status label in order (those with tasks), then "No status".
 * None: one section.
 */
export function searchSections(tasks: Task[], how: { sort: SearchSort; group: SearchGroup }, ctx: Context): SearchSection[] {
  const { sort, group } = how;
  const order = searchComparator(sort, ctx);
  switch (group.by) {
    case "list":
      return groupByList(tasks, ctx.lists, ctx.listOrder).map((g) => ({
        key: g.listId,
        title: g.list?.name ?? "Other list",
        rows: isDefault(sort) ? g.rows : flat(g.rows.map((r) => r.task).sort(order)),
      }));
    case "due":
      return groupByDue(tasks, ctx.today, ctx.timeZone, ctx.listOrder).map((g) => ({
        key: `due:${g.bucket}`,
        title: g.title,
        rows: isDefault(sort) ? g.rows : flat(g.rows.map((r) => r.task).sort(order)),
      }));
    case "label": {
      const given = group.labels ?? [];
      const seen = new Set(given.map((l) => l.toLowerCase()));
      const others = [...new Set(tasks.flatMap((t) => t.labels))]
        .filter((l) => !seen.has(l.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
      const names = [...given, ...others];
      const buckets = new Map<string, Task[]>(names.map((n) => [n.toLowerCase(), []]));
      const none: Task[] = [];
      for (const t of tasks) {
        const mine = new Set(t.labels.map((l) => l.toLowerCase()));
        const first = names.find((n) => mine.has(n.toLowerCase()));
        (first ? buckets.get(first.toLowerCase())! : none).push(t);
      }
      return [
        ...names.map((n) => ({ key: `label:${n.toLowerCase()}`, title: n, rows: flat(buckets.get(n.toLowerCase())!.sort(order)) })),
        { key: "label:", title: "No label", rows: flat(none.sort(order)) },
      ].filter((s) => s.rows.length > 0);
    }
    case "status": {
      const names = ctx.status ?? [];
      const buckets = new Map<string, Task[]>(names.map((n) => [n.toLowerCase(), []]));
      const none: Task[] = [];
      for (const t of tasks) {
        const mine = new Set(t.labels.map((l) => l.toLowerCase()));
        const first = names.find((n) => mine.has(n.toLowerCase()));
        (first ? buckets.get(first.toLowerCase())! : none).push(t);
      }
      return [
        ...names.map((n) => ({ key: `status:${n.toLowerCase()}`, title: n, rows: flat(buckets.get(n.toLowerCase())!.sort(order)) })),
        { key: "status:", title: "No status", rows: flat(none.sort(order)) },
      ].filter((s) => s.rows.length > 0);
    }
    case "none":
      return [{ key: "all", rows: flat([...tasks].sort(order)) }];
  }
}
