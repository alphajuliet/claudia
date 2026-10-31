import type { List, Task } from "@claudia/shared";
import { Link } from "wouter";
import { useFilters, useFilterTasks, useFolders, useLists, useTasks, useTimeZone } from "../data/queries";
import { todayIn } from "../lib/dates";
import { listOrder, sidebarTree } from "../lib/sidebar";
import { groupByList, isSnoozed, treeRows, type Row } from "../lib/tasks";
import { findInbox, viewQuery, VIEWS, type ViewId } from "../lib/views";
import { useContextFilter } from "./contextFilter";
import { TaskList, type Section } from "./TaskList";

export function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">There's nothing at this address.</p>
      <p><Link href="/inbox">Go to Inbox</Link></p>
    </>
  );
}

/**
 * Sections for a view or filter: open, unsnoozed tasks (headings left out) grouped by list in sidebar order,
 * narrowed to the current context. The Inbox list is not in the sidebar tree, so it is put first.
 */
function useGroupedSections(tasks: Task[] | undefined): Section[] {
  const { context } = useContextFilter();
  const folders = useFolders().data ?? [];
  const lists = useLists().data ?? [];
  const inboxId = findInbox(lists)?.id;
  const order = [...(inboxId ? [inboxId] : []), ...listOrder(sidebarTree(folders, lists.filter((l) => l.id !== inboxId), context))];
  const inContext = new Set(order);
  const shown = (tasks ?? []).filter((t) => t.kind === "task" && !isSnoozed(t) && (context === "all" || inContext.has(t.listId)));
  return groupByList(shown, lists, order).map((g) => ({ key: g.listId, title: g.list?.name ?? "Other list", rows: g.rows }));
}

export function ViewScreen({ id }: { id: string }) {
  const view = VIEWS.find((v) => v.id === id);
  if (!view) return <NotFound />;
  return <BuiltInView id={view.id} name={view.name} />;
}

function BuiltInView({ id, name }: { id: ViewId; name: string }) {
  const lists = useLists();
  const inbox = findInbox(lists.data ?? []);
  const query = viewQuery(id, { today: todayIn(useTimeZone()), inboxId: inbox?.id });
  const tasks = useTasks(query);
  const sections = useGroupedSections(tasks.data);
  const noInbox = id === "inbox" && lists.isSuccess && !inbox;
  return (
    <>
      <h1>{name}</h1>
      {noInbox ? (
        <p className="list-state muted">There's no list called Inbox.</p>
      ) : (
        <TaskList
          query={query === null ? { isPending: true, error: lists.error, refetch: lists.refetch } : tasks}
          // The Inbox is a single list, so its group title would only repeat the heading.
          sections={id === "inbox" ? sections.map((s) => ({ ...s, title: undefined })) : sections}
          empty={id === "inbox" ? "Inbox zero." : "Nothing here."}
        />
      )}
    </>
  );
}

/** Outline rows without snoozed tasks or anything under them. */
function visibleRows(tasks: Task[]): Row[] {
  const out: Row[] = [];
  let hiddenDepth = Infinity;
  for (const row of treeRows(tasks)) {
    if (row.depth > hiddenDepth) continue;
    hiddenDepth = Infinity;
    if (isSnoozed(row.task)) hiddenDepth = row.depth;
    else out.push(row);
  }
  return out;
}

/** List rows split into sections at each heading. */
function listSections(rows: Row[]): Section[] {
  const sections: Section[] = [{ key: "top", rows: [] }];
  for (const row of rows) {
    if (row.task.kind === "heading") sections.push({ key: row.task.id, title: row.task.title, rows: [] });
    else sections.at(-1)!.rows.push(row);
  }
  return sections;
}

export function ListScreen({ id }: { id: string }) {
  const lists = useLists();
  const list: List | undefined = lists.data?.find((l) => l.id === id);
  const tasks = useTasks(new URLSearchParams({ listId: id, status: "open", limit: "500" }).toString());
  if (lists.isSuccess && !list) return <NotFound />;
  return (
    <>
      <h1>{list?.name ?? "List"}</h1>
      <TaskList query={tasks} sections={listSections(visibleRows(tasks.data ?? []))} empty="Nothing here." />
    </>
  );
}

export function FilterScreen({ id }: { id: string }) {
  const filters = useFilters();
  const filter = filters.data?.find((f) => f.id === id);
  const tasks = useFilterTasks(id);
  const sections = useGroupedSections(tasks.data);
  if (filters.isSuccess && !filter) return <NotFound />;
  return (
    <>
      <h1>{filter?.name ?? "Filter"}</h1>
      <TaskList query={tasks} sections={sections} empty="Nothing here." />
    </>
  );
}
