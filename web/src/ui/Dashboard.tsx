import { useState, type ReactNode } from "react";
import type { Task } from "@claudia/shared";
import { Link } from "wouter";
import { useCounts, useFolders, useLabels, useLists, useSearchTasks, useTasks, useTimeZone, useViews, useViewTasks } from "../data/queries";
import { ageOf, dashboard, listsInContext, NEXT_DAYS, SECTION_LIMIT, statusCounts, WAITING_QUERY, wipByContext, WIP_LIMIT, type StatusCount } from "../lib/dashboard";
import { addDays, todayIn } from "../lib/dates";
import { findInbox } from "../lib/views";
import { isSnoozed } from "../lib/tasks";
import { CONTEXT_CHOICES, useContextFilter } from "./contextFilter";
import { QuickAdd } from "./QuickAdd";
import { useTaskFilter } from "./screens";
import { TaskList, type Section } from "./TaskList";

/** Sections load and fail on their own, so the list itself is always ready. */
const READY = { isPending: false, error: null, refetch: () => undefined };

/** "Sunday 1 November", for a day (YYYY-MM-DD). */
function longDate(date: string) {
  const parts = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** What stands in for a section's rows: it's loading, it failed, or there's nothing in it. */
function placeholder(query: SectionState, empty: string): ReactNode {
  // A failed refresh keeps the last data, so it doesn't count as failing here.
  if (query.error && !query.ready) {
    return (
      <div className="section-empty" role="alert">
        <p>{query.error.message}</p>
        <button type="button" className="quiet small" onClick={() => query.refetch()}>Try again</button>
      </div>
    );
  }
  return <p className="section-empty muted">{query.isPending ? "Loading…" : empty}</p>;
}

/** One section's query, with the lists and folders that choosing its tasks depends on. */
interface SectionState { ready: boolean; isPending: boolean; error: Error | null; refetch: () => unknown }

const rowsOf = (tasks: Task[]) => tasks.map((task) => ({ task, depth: 0 }));

/** A count against the WIP limit, marked when over it. */
const against = (n: number) => <span className={n > WIP_LIMIT ? "wip-over" : undefined}>{n}/{WIP_LIMIT}</span>;

/** Open tasks by status, as bars, each a link to the search that shows them. Desktop only (the CSS hides it). */
function StatusChart({ rows }: { rows: StatusCount[] }) {
  const most = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="status-chart" aria-labelledby="status-chart-title">
      <h2 id="status-chart-title">By status</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.label ?? ""}>
            <Link href={`/search?q=${encodeURIComponent(r.label ? `#${r.label}` : "-has:status")}`} className={r.label ? undefined : "muted"}>
              <span className="status-chart-name">{r.label ?? "No status"}</span>
              <span className="status-chart-track" aria-hidden="true">{r.count > 0 && <span className="status-chart-bar" style={{ width: `${(r.count / most) * 100}%` }} />}</span>
              <span className="status-chart-count">{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The daily start: what's in progress, due, coming up and waiting, as working rows. */
export function Dashboard() {
  const timeZone = useTimeZone();
  const today = todayIn(timeZone);
  const listsQuery = useLists();
  const foldersQuery = useFolders();
  const lists = listsQuery.data ?? [];
  const inbox = findInbox(lists);
  const { context } = useContextFilter();
  const inboxCount = useViews(context).data?.find((v) => v.id === "inbox")?.count;
  const countsData = useCounts().data;
  const labelsData = useLabels().data;
  const wipQuery = useViewTasks("wip", context, { keepPrevious: true });
  const waitingQuery = useSearchTasks(new URLSearchParams({ q: WAITING_QUERY, context, status: "open" }), { keepPrevious: true });
  const dueQuery = useTasks(new URLSearchParams({ status: "open", limit: "500", dueBefore: addDays(today, NEXT_DAYS) }).toString(), { keepPrevious: true });
  const shown = useTaskFilter();
  const [nextOpen, setNextOpen] = useState(false);
  const stateOf = (query: { data?: Task[]; isPending: boolean; error: Error | null; refetch: () => unknown }): SectionState => ({
    ready: Boolean(query.data && listsQuery.data && foldersQuery.data),
    isPending: query.isPending || listsQuery.isPending || foldersQuery.isPending,
    error: query.error ?? listsQuery.error ?? foldersQuery.error,
    refetch: () => {
      void query.refetch();
      void listsQuery.refetch();
      void foldersQuery.refetch();
    },
  });
  const wipState = stateOf(wipQuery);
  const dueState = stateOf(dueQuery);
  const waitingState = stateOf(waitingQuery);
  /** A count, once there's something to count. */
  const shownCount = (state: SectionState, n: number) => (state.ready ? n : "–");

  const { wip, dueNow, nextDays, waiting, counts } = dashboard({
    // WIP and Waiting come narrowed by the server (Waiting is a search, for blocked tasks too); the due list is a plain query, narrowed here.
    wip: (wipQuery.data ?? []).filter((t) => !isSnoozed(t)),
    due: (dueQuery.data ?? []).filter(shown),
    waiting: (waitingQuery.data ?? []).filter((t) => !isSnoozed(t)),
    today,
    timeZone,
  });
  const extra = (tasks: Task[]) => Math.max(0, tasks.length - SECTION_LIMIT);
  const moreLink = (tasks: Task[], href: string) => extra(tasks) > 0 && <Link href={href}>{extra(tasks)} more</Link>;

  // The limit is per context: with All chosen, each context's WIP against it.
  const wipAside = !wipState.ready ? null : context !== "all" ? against(wip.length) : (
    <span className="wip-contexts">
      {wipByContext(wip, lists, foldersQuery.data ?? []).map(({ context: c, count }) => (
        <span key={c}>{CONTEXT_CHOICES.find((choice) => choice.id === c)?.name} {against(count)}</span>
      ))}
    </span>
  );
  const statusRows = countsData && labelsData && listsQuery.data && foldersQuery.data && labelsData.some((l) => l.status)
    ? statusCounts(countsData, labelsData, listsInContext(lists, foldersQuery.data, context))
    : null;

  const sections: Section[] = [
    {
      key: "wip",
      title: "WIP",
      rows: rowsOf(wip),
      aside: wipAside,
      placeholder: placeholder(wipState, "Nothing in progress"),
    },
    {
      key: "due",
      title: "Overdue and today",
      rows: rowsOf(dueNow.slice(0, SECTION_LIMIT)),
      aside: moreLink(dueNow, "/today"),
      placeholder: placeholder(dueState, "Nothing overdue"),
    },
    {
      key: "waiting",
      title: "Waiting",
      rows: rowsOf(waiting.slice(0, SECTION_LIMIT)),
      aside: moreLink(waiting, `/search?q=${encodeURIComponent(WAITING_QUERY)}`),
      placeholder: placeholder(waitingState, "Nothing waiting"),
    },
    {
      key: "next",
      title: "Next 3 days",
      rows: rowsOf(nextOpen ? nextDays : nextDays.slice(0, SECTION_LIMIT)),
      aside: !nextOpen && extra(nextDays) > 0 && (
        <button type="button" className="quiet small" onClick={() => setNextOpen(true)}>{extra(nextDays)} more</button>
      ),
      placeholder: placeholder(dueState, "Nothing in the next 3 days"),
    },
  ];

  const waitingIds = new Set(waiting.map((t) => t.id));
  const rowNote = (task: Task) => {
    const list = lists.find((l) => l.id === task.listId)?.name;
    const age = waitingIds.has(task.id) ? ageOf(task) : null;
    return [age, list].filter(Boolean).join(" · ") || undefined;
  };

  return (
    <>
      <header className="screen-header"><h1>{longDate(today)}</h1></header>
      <nav className="dashboard-summary" aria-label="Summary">
        <Link href="/wip">{shownCount(wipState, counts.wip)} WIP</Link>
        <Link href="/today">{shownCount(dueState, counts.overdue)} Overdue</Link>
        <Link href="/today">{shownCount(dueState, counts.today)} Today</Link>
        {inbox && inboxCount !== undefined && <Link href="/inbox">{inboxCount} Inbox</Link>}
      </nav>
      <QuickAdd target={inbox && { listId: inbox.id, listName: inbox.name }} announce />
      <TaskList query={READY} sections={sections} empty="" split={2} rowNote={rowNote} />
      {statusRows && <StatusChart rows={statusRows} />}
    </>
  );
}
