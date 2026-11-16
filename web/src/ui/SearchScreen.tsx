import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { formatGroup, formatSort, type SearchGroup, type SearchSort, type Task } from "@claudia/shared";
import { SearchQueryError, useLists, useSearchTasks, useTimeZone } from "../data/queries";
import { todayIn } from "../lib/dates";
import { searchSections } from "../lib/search";
import { useContextFilter } from "./contextFilter";
import { useCommand } from "./keyboard";
import { combine, ScreenHeader, useListOrder } from "./screens";
import { useShowCompleted } from "./showCompleted";
import { TaskList } from "./TaskList";

const DELAY_MS = 250;

const SORTS: { value: string; label: string }[] = [
  { value: "list", label: "Priority and list" },
  { value: "due", label: "Due, soonest first" },
  { value: "due-desc", label: "Due, latest first" },
  { value: "start", label: "Start, soonest first" },
  { value: "start-desc", label: "Start, latest first" },
  { value: "created-desc", label: "Newest first" },
  { value: "created", label: "Oldest first" },
  { value: "updated-desc", label: "Recently changed" },
  { value: "title", label: "Title, A to Z" },
  { value: "title-desc", label: "Title, Z to A" },
];

const GROUPS: { value: string; label: string }[] = [
  { value: "list", label: "List" },
  { value: "due", label: "Due date" },
  { value: "label", label: "Label" },
  { value: "none", label: "None" },
];

const EXAMPLES: [string, string][] = [
  ["report", "Title or notes contain “report”"],
  ['"weekly report"', "The exact phrase"],
  ["#next  or  label:next", "Has the label next"],
  ["list:Garden  folder:Work", "In a list, or anywhere in a folder (ignoring a leading emoji; * is a wildcard)"],
  ["context:home", "In the Home context, whatever the sidebar shows"],
  ["priority:high  priority:>=normal", "By priority (low < normal < high)"],
  ["due:today  due:<=today  due:<7d", "Due today, by today, within a week"],
  ['start:<=today  completed:>=today-7d  due:["today" TO "2w"]', "Dates: today, tomorrow, yesterday, 7d, 2w, 3m, today-7d, 2026-12-25"],
  ["is:available  is:snoozed  is:completed", "Also open, recurring, heading, subtask"],
  ["has:due  -has:start", "Also notes, labels, parent"],
  ["#next AND (due:<=today OR #wip)", "AND, OR, NOT, -term and brackets; a space means AND"],
  ["sort:due-desc  group:label", 'Sort (due, start, created, updated, title, priority) and group (list, due, label, none, "label:wip,next")'],
];

function CheatSheet() {
  return (
    <div className="search-help" role="region" aria-label="Search help">
      <table>
        <tbody>
          {EXAMPLES.map(([q, what]) => (
            <tr key={q}>
              <td><code>{q}</code></td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Open, unsnoozed tasks unless the search says otherwise. The sidebar's context applies unless it names a context or folder.</p>
    </div>
  );
}

/** A menu for the sort or grouping: "set" puts it in the address, which wins over sort: or group: in the search. */
function Menu({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  // A typed grouping such as label:wip,next isn't one of the options: show it as it is.
  const all = options.some((o) => o.value === value) ? options : [...options, { value, label: value }];
  return (
    <label className="search-menu">
      <span className="muted">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Tasks matching a search in the query language (docs/plans/2026-11-16-search-language-design.md), sorted and
 * grouped as it or the menus say. The search, sort and grouping live in the address (`?q=&sort=&group=`), the
 * search updated a moment after typing stops, so reload and back keep them.
 */
export function SearchScreen() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const address = new URLSearchParams(search);
  const q = address.get("q") ?? "";
  const [text, setText] = useState(q);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The words this screen last put in the address. A different `q` came from elsewhere (Back, a link), and the
  // field takes it up.
  const written = useRef(q);
  if (q !== written.current) {
    written.current = q;
    if (text.trim() !== q) setText(q);
  }

  // `/` here goes back to the field, keeping the search.
  useCommand("search", () => {
    input.current?.focus();
    input.current?.select();
  });

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    navigate(query ? `${path}?${query}` : path, { replace: true });
  };

  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => {
      written.current = text.trim();
      setParam("q", text.trim());
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, q, search, path, navigate]);

  const { context } = useContextFilter();
  const [show] = useShowCompleted();
  const params = (status: string) => {
    const p = new URLSearchParams({ q, context, status });
    for (const name of ["sort", "group"]) if (address.get(name)) p.set(name, address.get(name)!);
    return p;
  };
  const open = useSearchTasks(q ? params("open") : null, { keepPrevious: true, keepsCompleted: show });
  const done = useSearchTasks(q && show ? params("completed") : null, { keepPrevious: true });

  // A search the server can't read shows why under the field, and the last results stay.
  const problem = open.error instanceof SearchQueryError ? open.error.message : null;
  const last = useRef<{ tasks: Task[]; sort: SearchSort; group: SearchGroup } | null>(null);
  if (!q) last.current = null;
  else if (open.data && open.how && !open.error) last.current = { tasks: open.data, sort: open.how.sort, group: open.how.group };
  const how = last.current ?? { sort: { by: "list", desc: false } as SearchSort, group: { by: "list" } as SearchGroup };

  const tasks = combine(
    { data: problem ? last.current?.tasks : open.data, isPending: open.isPending && !problem, error: problem ? null : open.error, refetch: open.refetch },
    done,
    show,
  );
  const { lists, order } = useListOrder();
  const timeZone = useTimeZone();
  const sections = searchSections(tasks.data ?? [], how, { lists, listOrder: order, today: todayIn(timeZone), timeZone });
  const allLists = useLists().data ?? [];
  const listName = (t: Task) => allLists.find((l) => l.id === t.listId)?.name;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
  };

  return (
    <>
      <ScreenHeader title="Search">
        <Menu label="Sort" value={formatSort(how.sort)} options={SORTS} onChange={(v) => setParam("sort", v)} />
        <Menu label="Group" value={formatGroup(how.group)} options={GROUPS} onChange={(v) => setParam("group", v)} />
      </ScreenHeader>
      <div className="quick-add search-field">
        <input
          type="search"
          className="quick-add-input"
          aria-label="Search"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "search-problem" : undefined}
          placeholder="Search, e.g. #next due:<=today"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="quiet small" aria-expanded={help} aria-label="Search help" title="How to search" onClick={() => setHelp(!help)}>?</button>
      </div>
      {problem && <p id="search-problem" className="search-problem" role="alert">{problem}</p>}
      {help && <CheatSheet />}
      {q ? (
        <TaskList query={tasks} sections={sections} empty="No tasks match." rowNote={how.group.by === "list" ? undefined : listName} />
      ) : (
        !help && <p className="list-state muted">Type to search, for example <code>#next due:&lt;=today</code>. The ? button beside the field lists the rest.</p>
      )}
    </>
  );
}
