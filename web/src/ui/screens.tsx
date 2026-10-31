import type { List, Task } from "@claudia/shared";
import { Link, Redirect } from "wouter";
import { useFilters, useFilterTasks, useFolders, useLists, useTasks, useTimeZone } from "../data/queries";
import { todayIn } from "../lib/dates";
import { listOrder, sidebarTree } from "../lib/sidebar";
import { groupByList, isSnoozed, treeRows, type Row } from "../lib/tasks";
import { findInbox, viewLabel, viewQuery, VIEWS, type ViewId } from "../lib/views";
import { useContextFilter } from "./contextFilter";
import { InlineRename, useRenameReported } from "./InlineRename";
import { useCommand } from "./keyboard";
import { QuickAdd, type QuickAddTarget } from "./QuickAdd";
import { useShowCompleted } from "./showCompleted";
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

/** The home address: the Inbox, or Today when there's no list called Inbox. */
export function Home() {
  const lists = useLists();
  if (lists.isPending) return null;
  return <Redirect to={lists.isSuccess && !findInbox(lists.data) ? "/today" : "/inbox"} replace />;
}

/** Open tasks first, then completed ones not already among them. */
function merge(open: Task[], done: Task[]): Task[] {
  const ids = new Set(open.map((t) => t.id));
  return [...open, ...done.filter((t) => !ids.has(t.id))];
}

/** A query string with its status replaced. */
const withStatus = (query: string, status: string) => {
  const q = new URLSearchParams(query);
  q.set("status", status);
  return q.toString();
};

interface Loaded { data: Task[] | undefined; isPending: boolean; error: Error | null; refetch: () => unknown }

/**
 * Combines a screen's open tasks with its completed ones (when shown). Completed tasks come from a query of their own,
 * so they never crowd open ones out of the limit, and the screen shows its open tasks without waiting for them.
 */
function combine(open: Loaded, done: Loaded, show: boolean, include: (t: Task) => boolean = () => true): Loaded {
  return {
    data: open.data && (show ? merge(open.data, (done.data ?? []).filter((t) => t.completedAt !== null && include(t))) : open.data),
    isPending: open.isPending,
    error: open.error ?? (show ? done.error : null),
    refetch: () => {
      void open.refetch();
      if (show) void done.refetch();
    },
  };
}

/** The Show completed toggle for a screen's header, with Shift+C. */
function ShowCompletedButton() {
  const [show, setShow] = useShowCompleted();
  useCommand("toggleCompleted", () => setShow(!show));
  return (
    <button type="button" className="quiet small" aria-pressed={show} onClick={() => setShow(!show)}>
      {show ? "Hide completed" : "Show completed"}
    </button>
  );
}

/** A screen's title (click to rename, when `onRename` is given) and its Show completed toggle. */
function ScreenHeader({ title, onRename }: { title: string; onRename?: (name: string) => void }) {
  return (
    <header className="screen-header">
      {onRename ? (
        <InlineRename name={title} label="List name" className="screen-title-input" onRename={onRename}>
          {(start) => (
            <h1>
              <button type="button" className="screen-title-button" title="Click to rename" onClick={start}>{title}</button>
            </h1>
          )}
        </InlineRename>
      ) : (
        <h1>{title}</h1>
      )}
      <ShowCompletedButton />
    </header>
  );
}

/**
 * Sections for a view or filter: open, unsnoozed tasks (headings left out) grouped by list in sidebar order,
 * narrowed to the current context. The Inbox list is not in the sidebar tree, so it is put first.
 */
export function useGroupedSections(tasks: Task[] | undefined): Section[] {
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
  const today = todayIn(useTimeZone());
  const query = viewQuery(id, { today, inboxId: inbox?.id });
  // Views add to the Inbox, with the view's label, or due today in Today.
  const label = viewLabel(id);
  const target: QuickAddTarget | undefined = inbox && {
    listId: inbox.id,
    listName: inbox.name,
    ...(label ? { labels: [label] } : {}),
    ...(id === "today" ? { dueToday: true } : {}),
  };
  const [show] = useShowCompleted();
  const open = useTasks(query, { keepPrevious: true, keepsCompleted: show });
  const done = useTasks(show && query ? withStatus(query, "completed") : null, { keepPrevious: true });
  const timeZone = useTimeZone();
  // Today shows what was completed today, not every task ever due before it.
  const tasks = combine(open, done, show, id === "today" ? (t) => todayIn(timeZone, new Date(t.completedAt!)) === today : undefined);
  const sections = useGroupedSections(tasks.data);
  const noInbox = id === "inbox" && lists.isSuccess && !inbox;
  return (
    <>
      <ScreenHeader title={name} />
      <QuickAdd target={target} announce />
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
    if (row.task.kind === "heading") sections.push({ key: row.task.id, title: row.task.title, heading: row.task, rows: [] });
    else sections.at(-1)!.rows.push(row);
  }
  return sections;
}

export function ListScreen({ id }: { id: string }) {
  const lists = useLists();
  const list: List | undefined = lists.data?.find((l) => l.id === id);
  const [show] = useShowCompleted();
  const rename = useRenameReported("lists");
  const query = new URLSearchParams({ listId: id, status: "open", limit: "500" }).toString();
  const open = useTasks(query, { keepPrevious: true, keepsCompleted: show });
  const done = useTasks(show ? withStatus(query, "completed") : null, { keepPrevious: true });
  const tasks = combine(open, done, show);
  if (lists.isSuccess && !list) return <NotFound />;
  return (
    <>
      <ScreenHeader title={list?.name ?? "List"} onRename={list ? (name) => rename(list.id, name) : undefined} />
      <QuickAdd target={list && { listId: list.id, listName: list.name }} />
      <TaskList query={tasks} sections={listSections(visibleRows(tasks.data ?? []))} empty="Nothing here." />
    </>
  );
}

export function FilterScreen({ id }: { id: string }) {
  const filters = useFilters();
  const filter = filters.data?.find((f) => f.id === id);
  const inbox = findInbox(useLists().data ?? []);
  const [show] = useShowCompleted();
  const open = useFilterTasks(id, { keepPrevious: true, keepsCompleted: show });
  const done = useFilterTasks(show ? id : null, { status: "completed", keepPrevious: true });
  // A filter's own query may match completed tasks: they show only with the toggle on.
  const tasks = combine({ ...open, data: open.data?.filter((t) => show || t.completedAt === null) }, done, show);
  const sections = useGroupedSections(tasks.data);
  if (filters.isSuccess && !filter) return <NotFound />;
  return (
    <>
      <ScreenHeader title={filter?.name ?? "Filter"} />
      <QuickAdd target={inbox && { listId: inbox.id, listName: inbox.name }} announce />
      <TaskList query={tasks} sections={sections} empty="Nothing here." />
    </>
  );
}
