# Desktop UI Step 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the signed-in placeholder with a three-pane-ready desktop shell: sidebar (views, saved filters, folder and list tree, context switch), routed task lists, and completing tasks with undo.

**Architecture:** Pure logic in `web/src/lib/` (dates, task tree and grouping, sidebar tree, view queries) with unit tests. Server state through TanStack Query hooks in `web/src/data/` that call the session's `api()` and parse with `@claudia/shared` schemas. Screens in `web/src/ui/`. Routing with `wouter`. Design: `docs/plans/2026-10-31-desktop-ui-design.md`.

**Tech Stack:** React 19, TanStack Query 5, wouter, Vitest 4 + jsdom + Testing Library.

---

Conventions: Australian English in UI copy. Small commits with imperative messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run commands from the repo root. Never print tokens. Existing pieces: `web/src/session/` (SessionProvider with `useSession()` giving `state`, `api(path, init)`, `signOut()`), `web/src/App.tsx` (exports `App` and `Gate`; `Gate` renders `<Shell />` when signed in), `web/src/Shell.tsx` (placeholder to replace), `web/src/styles.css`. Web tests stub `fetch` with `vi.stubGlobal`; `web/src/test-setup.ts` cleans up after each test.

### Task 1: Pure helpers

**Files:**
- Create: `web/src/lib/dates.ts`, `web/src/lib/tasks.ts`, `web/src/lib/sidebar.ts`, `web/src/lib/views.ts`
- Test: `web/src/lib/dates.test.ts`, `web/src/lib/tasks.test.ts`, `web/src/lib/sidebar.test.ts`, `web/src/lib/views.test.ts`

**`web/src/lib/dates.ts`:**

```ts
const DAY_MS = 86_400_000;
export const DEFAULT_TIME_ZONE = "Australia/Sydney";

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", ...opts }).format(toUtc(date));

/** A due date as a short relative label, e.g. "Today", "Tomorrow", "Fri", "3 Nov", "3 Nov 2027". */
export function formatDue(date: string, today: string): { text: string; overdue: boolean } {
  const days = daysBetween(today, date);
  const overdue = days < 0;
  if (days === 0) return { text: "Today", overdue };
  if (days === 1) return { text: "Tomorrow", overdue };
  if (days === -1) return { text: "Yesterday", overdue };
  if (days > 1 && days < 7) return { text: fmt(date, { weekday: "short" }), overdue };
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return { text: fmt(date, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }), overdue };
}
```

Tests (2026-10-31 is a Saturday): `formatDue("2026-10-31", "2026-10-31")` is `{ text: "Today", overdue: false }`; `"2026-11-01"` → "Tomorrow"; `"2026-10-30"` → "Yesterday", overdue; `"2026-11-03"` → "Tue"; `"2026-11-07"` → "7 Nov"; `"2026-10-20"` → "20 Oct", overdue; `"2027-01-05"` → "5 Jan 2027". `todayIn("Australia/Sydney", new Date("2026-10-30T14:00:00Z"))` → "2026-10-31". If Node's ICU formats a month or weekday differently (e.g. "Nov." or "Tue."), adjust the expectation to the real output and say so.

**`web/src/lib/tasks.ts`:**

```ts
import type { List, Task } from "@claudia/shared";

export interface Row { task: Task; depth: number }

/** Snoozed until a time still in the future. */
export const isSnoozed = (t: Task, now = new Date()) => t.snoozedUntil !== null && t.snoozedUntil > now.toISOString();

/**
 * Tasks in outline order: siblings by position, each followed by its subtasks.
 * A task whose parent is not in the set (e.g. a label view) is shown at the top level.
 */
export function treeRows(tasks: Task[]): Row[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    (children.get(key) ?? children.set(key, []).get(key)!).push(t);
  }
  for (const list of children.values()) list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const rows: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of children.get(parent) ?? []) {
      rows.push({ task: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export interface Group { listId: string; list: List | undefined; rows: Row[] }

/** Tasks grouped by list, groups in `listOrder` (lists not in it go last), each group in outline order. */
export function groupByList(tasks: Task[], lists: List[], listOrder: string[]): Group[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const rank = new Map(listOrder.map((id, i) => [id, i]));
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) (buckets.get(t.listId) ?? buckets.set(t.listId, []).get(t.listId)!).push(t);
  return [...buckets.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
    .map(([listId, ts]) => ({ listId, list: byId.get(listId), rows: treeRows(ts) }));
}
```

Tests: outline order with nested children and out-of-order positions (positions are fractional-index strings like "a0", "a1", "a0V"; plain string comparison is correct); an orphan subtask becomes top level with depth 0; groups follow `listOrder`, and an unknown list goes last; `isSnoozed` true only for a future `snoozedUntil`. Build tasks with a small `task(overrides)` factory in the test that fills every `Task` field.

**`web/src/lib/sidebar.ts`:**

```ts
import type { Folder, List } from "@claudia/shared";

export type ContextFilter = "all" | Folder["context"];
export interface FolderNode { folder: Folder; lists: List[]; folders: FolderNode[] }
export interface SidebarTree { lists: List[]; folders: FolderNode[] }

const byPosition = <T extends { position: string }>(a: T, b: T) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/**
 * Folders and live lists as a tree, both in position order. Folders outside the context are dropped
 * with everything under them; lists not in any folder show in every context.
 */
export function sidebarTree(folders: Folder[], lists: List[], context: ContextFilter): SidebarTree {
  const live = lists.filter((l) => l.archivedAt === null);
  const node = (f: Folder): FolderNode => ({
    folder: f,
    lists: live.filter((l) => l.folderId === f.id).sort(byPosition),
    folders: folders.filter((c) => c.parentId === f.id && (context === "all" || c.context === context)).sort(byPosition).map(node),
  });
  return {
    lists: live.filter((l) => l.folderId === null).sort(byPosition),
    folders: folders.filter((f) => f.parentId === null && (context === "all" || f.context === context)).sort(byPosition).map(node),
  };
}

/** List IDs in the order the sidebar shows them: unfiled lists, then each folder's lists before its subfolders. */
export function listOrder(tree: SidebarTree): string[] {
  const out = tree.lists.map((l) => l.id);
  const walk = (n: FolderNode) => {
    out.push(...n.lists.map((l) => l.id));
    n.folders.forEach(walk);
  };
  tree.folders.forEach(walk);
  return out;
}
```

Tests: tree nesting and order; archived lists dropped; context "work" drops a personal folder and its lists but keeps unfiled lists; `listOrder` order.

**`web/src/lib/views.ts`:**

```ts
import type { List } from "@claudia/shared";

export const VIEWS = [
  { id: "inbox", name: "Inbox" },
  { id: "today", name: "Today" },
  { id: "next", name: "Next" },
  { id: "wip", name: "WIP" },
  { id: "waiting", name: "Waiting" },
  { id: "someday", name: "Someday" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];

const LABELS: Partial<Record<ViewId, string>> = { next: "next", wip: "wip", waiting: "waitingOn", someday: "someday" };

export const findInbox = (lists: List[]) => lists.find((l) => l.archivedAt === null && l.name.toLowerCase() === "inbox");

/** The `GET /api/tasks` query string for a built-in view, or null when it can't be built (no Inbox list). */
export function viewQuery(id: ViewId, ctx: { today: string; inboxId: string | undefined }): string | null {
  const q = new URLSearchParams({ status: "open", limit: "500" });
  if (id === "inbox") {
    if (!ctx.inboxId) return null;
    q.set("listId", ctx.inboxId);
  } else if (id === "today") q.set("dueBefore", ctx.today);
  else q.set("label", LABELS[id]!);
  return q.toString();
}
```

Tests: each view's query string; inbox without a list is null; `findInbox` ignores case and archived lists.

**Steps:** write the four test files, run `npm test -w @claudia/web` (fail), add the modules, run again (pass), `npm run typecheck`. Commit "Add web helpers for dates, task trees, the sidebar and views".

### Task 2: Data hooks and routing dependency

**Files:**
- Modify: `web/package.json` (`npm install -w @claudia/web wouter`)
- Create: `web/src/data/queries.ts`
- Test: `web/src/data/queries.test.tsx`

**`web/src/data/queries.ts`** exports, all built on `useSession().api` and `useQuery`/`useMutation` from TanStack Query:

- `useFolders()`, `useLists()`, `useFilters()`: `GET /api/folders`, `/api/lists`, `/api/filters`, parsed with `z.array(FolderSchema)` etc. from `@claudia/shared` (import `z` from `zod`; check what `shared` itself imports and use the same). Query keys `["folders"]`, `["lists"]`, `["filters"]`.
- `useTimeZone()`: `GET /api/settings`, returns `settings.timeZone` if it is a non-empty string, else `DEFAULT_TIME_ZONE`. Key `["settings"]`.
- `useTasks(query: string | null)`: `GET /api/tasks?{query}`, disabled when `query` is null. Key `["tasks", query]`.
- `useFilterTasks(id: string)`: `GET /api/filters/{id}/tasks`. Key `["tasks", "filter", id]`.
- `useSetCompleted()`: a mutation taking `{ task, done }` that POSTs `/api/tasks/{id}/complete` or `/uncomplete` and returns the parsed `Task`. Optimistic update over every cached `["tasks", ...]` query: on mutate, cancel those queries, snapshot them, and replace the task: when completing a task with no `recurRule`, remove it; otherwise leave it. On error, restore the snapshots. On success, write the server's task into each cached list: replace it if present (a repeating task comes back open with its new due date), remove it if it is now completed, and for an uncomplete re-insert is not needed because `onSettled` invalidates `["tasks"]`.
- A shared `json<T>(res, schema)` helper that throws an `Error` with the API's `error.message` when `!res.ok`.

Tests (render hooks with `renderHook` inside a `QueryClientProvider` and a signed-in `SessionProvider`; stub `fetch` to answer `/api/me` first, then the call under test, routing on URL): `useLists` parses; `useTasks(null)` makes no request; `useSetCompleted` removes a plain task from a cached list at once and restores it when the server returns 500.

**Steps:** TDD as usual; `npm test`, `npm run typecheck`. Commit "Add web data hooks for lists, filters and tasks".

### Task 3: App shell, sidebar and routing

**Files:**
- Create: `web/src/ui/AppShell.tsx`, `web/src/ui/Sidebar.tsx`
- Modify: `web/src/App.tsx` (signed-in branch renders `<AppShell />`), delete `web/src/Shell.tsx`, `web/src/styles.css`
- Test: `web/src/ui/AppShell.test.tsx`; update `web/src/App.test.tsx` where it expects the old placeholder text ("Signed in as …"): the shell now shows the token name in the sidebar footer, e.g. "laptop" next to Sign out. Keep those tests' intent.

**Behaviour:**
- `AppShell` lays out a `<nav>` sidebar and a `<main>` content area with wouter routes: `/` redirects to `/inbox`; `/:view` for the six built-in views; `/list/:id`; `/filter/:id`; anything else shows "Not found" with a link to Inbox. Content for this task can be a stub heading per route (Task 4 fills it in), e.g. `<h1>Next</h1>`.
- `Sidebar`: the six views as links (Inbox hidden when `findInbox` finds none), then saved filters as links if any, then the folder tree from `sidebarTree` (folders as collapsible `<details open>` with their name, lists as links), then the footer with the token name and a Sign out button. The current route's link has `aria-current="page"`.
- Context switch: a segmented control (All, Work, Personal, Home) at the top of the sidebar. Store the choice in `localStorage` under `claudia.context` with try/catch (same pattern as `web/src/session/store.ts`); default "all". Provide it to the content area through a small React context (`useContextFilter()`), because Task 4 filters views by it.
- Responsive: under 900px wide the sidebar is hidden behind a "Menu" button in a top bar and opens as an overlay drawer; choosing a link closes it. Pure CSS media queries plus one `open` state.
- Styles: replace `styles.css` with CSS custom properties for colours (`--bg`, `--fg`, `--muted`, `--accent`, `--danger`, `--border`, `--row-hover`), light values in `:root` and dark ones under `@media (prefers-color-scheme: dark)`. System font, 14–15px base, comfortable row height, sidebar about 260px. Keep the sign-in screen looking reasonable with the new styles.

Tests: signed-in shell shows the views and the folder tree from stubbed `/api/folders` and `/api/lists`; the context switch to Work hides a personal folder and is remembered after re-render; a list link navigates to `/list/:id` (use wouter's `memoryLocation` or `Router` with a `hook` for tests); unknown route shows Not found.

**Steps:** TDD; `npm test`, `npm run typecheck`, `npm run build`. Commit "Add the desktop shell with sidebar and routes".

### Task 4: Task lists and completing

**Files:**
- Create: `web/src/ui/TaskList.tsx`, `web/src/ui/TaskRow.tsx`, `web/src/ui/Toast.tsx`, route screens in `web/src/ui/screens.tsx` (`ViewScreen`, `ListScreen`, `FilterScreen`)
- Modify: `web/src/ui/AppShell.tsx` (routes render the screens), styles
- Test: `web/src/ui/TaskList.test.tsx`

**Behaviour:**
- `ViewScreen` (built-in view): heading with the view name; `viewQuery` with `todayIn(useTimeZone())` and `findInbox`; tasks grouped by list with `groupByList` in `listOrder(sidebarTree(...current context))` order, each group under its list name. Only tasks whose list is in the current context's `listOrder` are shown (with "all", every task). Snoozed tasks are hidden. Headings (`kind: "heading"`) are not shown in views.
- `ListScreen`: heading with the list name; rows in `treeRows` order, subtasks indented by depth, headings as section titles (no checkbox). Snoozed tasks hidden.
- `FilterScreen`: heading with the filter name; grouped like a view.
- Empty states: "Nothing here." (Inbox: "Inbox zero."). Loading: a quiet "Loading…". Error: the message and a Try again button (refetch).
- `TaskRow`: checkbox (accessible label "Complete {title}"), title, label chips, due date via `formatDue` (overdue styled with `--danger`), a small repeat marker when `recurRule` is set.
- Completing: the checkbox calls `useSetCompleted`. For a plain task, show a toast "Completed “{title}”" with an Undo button (uncomplete) for 5 seconds. For a repeating task, the toast says "Next due {formatDue(newDue)}" (use the server response). One toast at a time; a new one replaces the old. Toast has `role="status"`.

Tests: Next view groups tasks under list names in sidebar order and hides a snoozed task; a list shows a subtask indented under its parent and a heading as a section title; completing a plain task removes it and Undo calls `/uncomplete`; completing a repeating task keeps it with the new due date and shows "Next due"; a failed complete restores the row and shows the error.

**Steps:** TDD; `npm test`, `npm run typecheck`, `npm run build`. Commit "Show task lists and complete tasks in the web app".

### Task 5: Review, docs and hands-on

- Independent code review of Tasks 1–4; fix findings.
- README: one line that the web app now has the desktop views (Inbox, Today, Next, WIP, Waiting, Someday, saved filters, lists).
- Andrew pushes, then checks on production: views match what Godspeed showed, completing and Undo work, the context switch, and the narrow-window drawer.
- Then a `#Decision` line in the Obsidian note (views in code, view list and order, wouter, hand-written CSS) and plan step 2.
