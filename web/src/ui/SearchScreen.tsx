import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { formatGroup, formatSort, type Filter, type SearchGroup, type SearchSort, type Task } from "@claudia/shared";
import { SearchQueryError, useCreateFilter, useDeleteContainer, useFilters, useLabels, useLists, useSearchTasks, useTimeZone, useUpdateFilter } from "../data/queries";
import { todayIn } from "../lib/dates";
import { searchSections } from "../lib/search";
import { statusLabels } from "../lib/status";
import { useContextFilter } from "./contextFilter";
import { useRenameReported } from "./InlineRename";
import { useCommand } from "./keyboard";
import { RowMenu } from "./RowMenu";
import { combine, NotFound, ScreenHeader, useListOrder } from "./screens";
import { useShowCompleted } from "./showCompleted";
import { TaskList } from "./TaskList";
import { useToast } from "./Toast";

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
  { value: "status", label: "Status" },
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
  ["is:available  is:snoozed  is:completed", "Also open, recurring, heading, subtask, inbox"],
  ["has:due  -has:start", "Also notes, labels, status, parent"],
  ["#next AND (due:<=today OR #wip)", "AND, OR, NOT, -term and brackets; a space means AND"],
  ["sort:due-desc  group:label", 'Sort (due, start, created, updated, title, priority) and group (list, due, label, status, none, "label:wip,next")'],
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

/** A menu for the sort or grouping. A choice here wins over sort: or group: in the search. */
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

/** What a search screen shows: the search, the sort and grouping chosen in the menus (null: the search's or the default), and Show completed. */
export interface QueryState {
  q: string;
  sort: string | null;
  group: string | null;
  show: boolean;
}

/** The field that names a new smart view: Enter saves, Escape (or leaving it empty) cancels. */
function NameField({ onDone }: { onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name?.trim() || null);
  };
  return (
    <div className="quick-add search-name">
      <input
        autoFocus
        className="quick-add-input"
        aria-label="Smart view name"
        placeholder="Name the smart view, then press Enter"
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") finish(e.currentTarget.value);
          else if (e.key === "Escape") {
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={(e) => { if (!e.currentTarget.value.trim()) finish(null); }}
      />
    </div>
  );
}

/**
 * A search in the query language (docs/plans/2026-11-16-search-language-design.md) and its results, sorted and grouped
 * as it or the menus say: the Search screen and each smart view. `value` holds what's shown and `onChange` takes
 * changes, the search a moment after typing stops (or when the field loses focus). `actions` sit in the header
 * before the menus, and `below` under the field.
 */
function QueryView({ title, value, onChange, onRename, actions, below, empty, focusField = true }: {
  title: string;
  /** Whether the field takes the keyboard when the screen opens (a smart view leaves it to the tasks). */
  focusField?: boolean;
  value: QueryState;
  onChange: (change: Partial<QueryState>) => void;
  onRename?: ((name: string) => void) | undefined;
  actions?: (problem: string | null) => ReactNode;
  below?: ReactNode;
  empty: ReactNode;
}) {
  const { q } = value;
  const [text, setText] = useState(q);
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The words this screen last passed on. A different `q` came from elsewhere (Back, a link, Revert), and the
  // field takes it up.
  const written = useRef(q);
  if (q !== written.current) {
    written.current = q;
    if (text.trim() !== q) setText(q);
  }
  const latest = useRef(onChange);
  latest.current = onChange;
  const flush = () => {
    if (text.trim() === q) return;
    written.current = text.trim();
    latest.current({ q: text.trim() });
  };

  // `/` here goes back to the field, keeping the search.
  useCommand("search", () => {
    input.current?.focus();
    input.current?.select();
  });

  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => {
      written.current = text.trim();
      latest.current({ q: text.trim() });
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, q]);

  const { context } = useContextFilter();
  const params = (status: string) => {
    const p = new URLSearchParams({ q, context, status });
    if (value.sort) p.set("sort", value.sort);
    if (value.group) p.set("group", value.group);
    return p;
  };
  const open = useSearchTasks(q ? params("open") : null, { keepPrevious: true, keepsCompleted: value.show });
  const done = useSearchTasks(q && value.show ? params("completed") : null, { keepPrevious: true });

  // A search the server can't read shows why under the field, and the last results stay.
  const problem = open.error instanceof SearchQueryError ? open.error.message : null;
  const last = useRef<{ tasks: Task[]; sort: SearchSort; group: SearchGroup } | null>(null);
  if (!q) last.current = null;
  else if (open.data && open.how && !open.error) last.current = { tasks: open.data, sort: open.how.sort, group: open.how.group };
  const how = last.current ?? { sort: { by: "list", desc: false } as SearchSort, group: { by: "list" } as SearchGroup };

  const tasks = combine(
    { data: problem ? last.current?.tasks : open.data, isPending: open.isPending && !problem, error: problem ? null : open.error, refetch: open.refetch },
    done,
    value.show,
  );
  const { lists, order } = useListOrder();
  const timeZone = useTimeZone();
  const status = statusLabels(useLabels().data ?? []).map((l) => l.name);
  const sections = searchSections(tasks.data ?? [], how, { lists, listOrder: order, today: todayIn(timeZone), timeZone, status });
  const allLists = useLists().data ?? [];
  const listName = (t: Task) => allLists.find((l) => l.id === t.listId)?.name;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) flush();
  };

  return (
    <>
      <ScreenHeader title={title} onRename={onRename} renameLabel="Smart view name" completed={[value.show, (show) => onChange({ show })]}>
        {actions?.(problem)}
        <Menu label="Sort" value={formatSort(how.sort)} options={SORTS} onChange={(v) => onChange({ sort: v })} />
        <Menu label="Group" value={formatGroup(how.group)} options={GROUPS} onChange={(v) => onChange({ group: v })} />
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
          autoFocus={focusField}
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={flush}
        />
        <button type="button" className="quiet small" aria-expanded={help} aria-label="Search help" title="How to search" onClick={() => setHelp(!help)}>?</button>
      </div>
      {problem && <p id="search-problem" className="search-problem" role="alert">{problem}</p>}
      {below}
      {help && <CheatSheet />}
      {q ? (
        <TaskList query={tasks} sections={sections} empty="No tasks match." rowNote={how.group.by === "list" ? undefined : listName} />
      ) : (
        !help && empty
      )}
    </>
  );
}

/**
 * The Search screen. The search, sort and grouping live in the address (`?q=&sort=&group=`), so reload and back keep
 * them; Show completed is the browser's. Save as smart view keeps the search in the sidebar.
 */
export function SearchScreen() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const address = new URLSearchParams(search);
  const [show, setShow] = useShowCompleted();
  const value: QueryState = { q: address.get("q") ?? "", sort: address.get("sort"), group: address.get("group"), show };
  const [naming, setNaming] = useState(false);
  const create = useCreateFilter();
  const toast = useToast();

  const onChange = (change: Partial<QueryState>) => {
    if (change.show !== undefined) setShow(change.show);
    const next = new URLSearchParams(search);
    for (const name of ["q", "sort", "group"] as const) {
      if (!(name in change)) continue;
      const v = change[name];
      if (v) next.set(name, v);
      else next.delete(name);
    }
    const query = next.toString();
    if (query !== search) navigate(query ? `${path}?${query}` : path, { replace: true });
  };

  const save = (name: string | null) => {
    setNaming(false);
    if (!name) return;
    create.mutateAsync({ name, query: value.q, sort: value.sort, group: value.group, display: value.show ? { showCompleted: true } : {} }).then(
      (made) => navigate(`/filter/${made.id}`),
      (e: Error) => toast.show({ message: e.message, error: true }),
    );
  };

  return (
    <QueryView
      title="Search"
      value={value}
      onChange={onChange}
      actions={(problem) => value.q && !problem && !naming && (
        <button type="button" className="quiet small" onClick={() => setNaming(true)}>Save as smart view</button>
      )}
      below={naming && <NameField onDone={save} />}
      empty={<p className="list-state muted">Type to search, for example <code>#next due:&lt;=today</code>. The ? button beside the field lists the rest.</p>}
    />
  );
}

/** What a smart view keeps, as the screen shows it. */
const savedState = (f: Filter): QueryState => ({ q: f.query, sort: f.sort, group: f.group, show: f.display.showCompleted ?? false });
const same = (a: QueryState, b: QueryState) => a.q === b.q && a.sort === b.sort && a.group === b.group && a.show === b.show;

/**
 * A smart view: a saved search, sort, grouping and Show completed, shown as the Search screen shows them. Changes show
 * at once; Save keeps them and Revert goes back. The title renames it, and its menu deletes it.
 */
export function SmartViewScreen({ id }: { id: string }) {
  const filters = useFilters();
  const filter = filters.data?.find((f) => f.id === id);
  const [draft, setDraft] = useState<{ id: string; value: QueryState } | null>(null);
  const update = useUpdateFilter();
  const remove = useDeleteContainer("filters");
  const rename = useRenameReported("filters");
  const toast = useToast();
  const [, navigate] = useLocation();
  if (filters.isSuccess && !filter) return <NotFound />;
  if (!filter) return null;

  const saved = savedState(filter);
  // An edit belongs to the view it was made in.
  const value = draft?.id === id ? draft.value : saved;
  const changed = !same(value, saved);
  const fail = (e: Error) => toast.show({ message: e.message, error: true });

  const save = () => {
    update.mutateAsync({ id, query: value.q, sort: value.sort, group: value.group, display: { ...filter.display, showCompleted: value.show } }).then(
      () => setDraft(null),
      fail,
    );
  };
  const del = () => {
    remove.mutateAsync(id).then(() => {
      navigate("/");
      toast.show({ message: `Deleted “${filter.name}”` });
    }, fail);
  };

  return (
    <QueryView
      key={id}
      title={filter.name}
      focusField={!filter.query}
      value={value}
      onChange={(change) => setDraft({ id, value: { ...value, ...change } })}
      onRename={(name) => rename(id, name)}
      actions={(problem) => (
        <>
          {changed && (
            <>
              <button type="button" className="small" disabled={Boolean(problem) || update.isPending} onClick={save}>Save</button>
              <button type="button" className="quiet small" onClick={() => setDraft(null)}>Revert</button>
            </>
          )}
          <RowMenu label={`${filter.name} smart view menu`} items={[{ label: "Delete", danger: true, onSelect: del }]} />
        </>
      )}
      empty={<p className="list-state muted">This smart view has no search yet. Type one above, then Save.</p>}
    />
  );
}
