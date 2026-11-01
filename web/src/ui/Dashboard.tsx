import { useState, type ReactNode } from "react";
import type { Task } from "@claudia/shared";
import { Link } from "wouter";
import { useCounts, useFolders, useLists, useTasks, useTimeZone } from "../data/queries";
import { ageOf, dashboard, SECTION_LIMIT, WIP_LIMIT } from "../lib/dashboard";
import { addDays, todayIn } from "../lib/dates";
import { findInbox, viewCount, viewQuery } from "../lib/views";
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

/** The daily start: what's in progress, due, coming up and waiting, as working rows. */
export function Dashboard() {
  const timeZone = useTimeZone();
  const today = todayIn(timeZone);
  const listsQuery = useLists();
  const foldersQuery = useFolders();
  const lists = listsQuery.data ?? [];
  const inbox = findInbox(lists);
  const inboxCount = useCounts().data;
  const ctx = { today, inboxId: inbox?.id };
  const wipQuery = useTasks(viewQuery("wip", ctx), { keepPrevious: true });
  const waitingQuery = useTasks(viewQuery("waiting", ctx), { keepPrevious: true });
  const dueQuery = useTasks(new URLSearchParams({ status: "open", limit: "500", dueBefore: addDays(today, 7) }).toString(), { keepPrevious: true });
  const shown = useTaskFilter();
  const [weekOpen, setWeekOpen] = useState(false);
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

  const { wip, dueNow, thisWeek, waiting, counts } = dashboard({
    wip: (wipQuery.data ?? []).filter(shown),
    due: (dueQuery.data ?? []).filter(shown),
    waiting: (waitingQuery.data ?? []).filter(shown),
    today,
    timeZone,
  });
  const extra = (tasks: Task[]) => Math.max(0, tasks.length - SECTION_LIMIT);
  const moreLink = (tasks: Task[], href: string) => extra(tasks) > 0 && <Link href={href}>{extra(tasks)} more</Link>;

  const sections: Section[] = [
    {
      key: "wip",
      title: "WIP",
      rows: rowsOf(wip),
      aside: wipState.ready && <span className={wip.length > WIP_LIMIT ? "wip-over" : undefined}>{wip.length}/{WIP_LIMIT}</span>,
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
      key: "week",
      title: "This week",
      rows: rowsOf(weekOpen ? thisWeek : thisWeek.slice(0, SECTION_LIMIT)),
      aside: !weekOpen && extra(thisWeek) > 0 && (
        <button type="button" className="quiet small" onClick={() => setWeekOpen(true)}>{extra(thisWeek)} more</button>
      ),
      placeholder: placeholder(dueState, "Nothing this week"),
    },
    {
      key: "waiting",
      title: "Waiting",
      rows: rowsOf(waiting.slice(0, SECTION_LIMIT)),
      aside: moreLink(waiting, "/waiting"),
      placeholder: placeholder(waitingState, "Nothing waiting"),
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
        {inbox && inboxCount && <Link href="/inbox">{viewCount("inbox", inboxCount, "all", inbox.id)} Inbox</Link>}
      </nav>
      <QuickAdd target={inbox && { listId: inbox.id, listName: inbox.name }} announce />
      <TaskList query={READY} sections={sections} empty="" split={2} rowNote={rowNote} />
    </>
  );
}
