# Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the daily start Dashboard (design: `2026-11-01-dashboard-design.md`): WIP, Overdue and today, This week and Waiting as working task rows, in two columns, opening at `/`.

**Architecture:** A pure `web/src/lib/dashboard.ts` sorts three task queries into sections. `web/src/ui/Dashboard.tsx` passes them to the one existing `TaskList`, so `j`/`k`, swipes, sheets and the panel work across every section. `TaskList` gains a split into two columns, a per-section placeholder and aside, and a row note. No API change.

**Tech Stack:** React, TanStack Query, wouter, Vitest with Testing Library and the fake API in `web/src/ui/testApi.tsx`, hand-written CSS.

Conventions: Australian English, short doc comments, small imperative commits ending with the `Co-Authored-By` line, tests first. Run `npm test -w @claudia/web` and `npm run typecheck`.

**One change from the design:** one query, `dueBefore=today+7`, serves both Overdue and today and This week, so no separate 7-day query is needed.

---

### Task 1: Sort tasks into sections

**Files:** Create `web/src/lib/dashboard.ts`, `web/src/lib/dashboard.test.ts`.

**API:**

```ts
export const WIP_LIMIT = 3;
export const SECTION_LIMIT = 5;
export interface DashboardInput { wip: Task[]; due: Task[]; waiting: Task[]; today: string; timeZone: string }
export interface Dashboard {
  wip: Task[]; dueNow: Task[]; thisWeek: Task[]; waiting: Task[];
  /** Before duplicates are removed, so they match the views they link to. */
  counts: { wip: number; overdue: number; today: number };
}
export function dashboard(input: DashboardInput): Dashboard;
/** Whole days since the task was created, as "12d", or null within the first day. */
export function ageOf(task: Task, now?: Date): string | null;
```

**Rules:**
- `due` splits on `dueDateOf(task, timeZone)`: on or before `today` is `dueNow`, later is `thisWeek`. A task with no date in `due` is dropped.
- A task appears once, in the order `wip`, `dueNow`, `thisWeek`, `waiting`.
- `dueNow` and `thisWeek` sort by date, then due time (`dueAt`), with date-only tasks first on a day. `waiting` sorts by `createdAt`, oldest first. `wip` keeps the order given.
- `counts.overdue` is due before `today`, and `counts.today` is due on `today`.

**Tests first:** one test per rule, using the `task()` shape from `web/src/lib/tasks.test.ts`.

**Commit:** `Sort tasks into Dashboard sections`.

---

### Task 2: Teach TaskList about the Dashboard

**Files:** Modify `web/src/ui/TaskList.tsx`, `web/src/ui/TaskRow.tsx`, `web/src/styles.css`.

- `Section` gains `aside?: ReactNode` (after the title, in the `h2`) and `placeholder?: ReactNode` (shown when it has no rows).
- `TaskList` gains `split?: number` (sections before that index go in the first of two `.task-column` divs, and `.task-sections` gains `split`) and `rowNote?: (task: Task) => string | undefined`.
- `TaskRow` gains `note?: string`, a `.task-note` span at the end of `.task-meta`.
- CSS: `.task-sections.split` is a grid of `repeat(auto-fit, minmax(20rem, 1fr))` with a gap, so it stacks by itself when narrow or when the panel takes the room. `.content > .task-sections.split { max-width: 72rem; }`. `.task-note` is muted and small. `.section-aside` sits at the right of the title; `.wip-over` uses `--danger`.

Existing behaviour must not change: run the whole web suite. Covered through Task 3's screen tests.

**Commit:** `Let the task list split into columns and show notes and placeholders`.

---

### Task 3: The Dashboard screen

**Files:** Create `web/src/ui/Dashboard.tsx`, `web/src/ui/dashboard.test.tsx`; Modify `web/src/ui/screens.tsx`, `web/src/styles.css`.

- In `screens.tsx`, extract `useTaskFilter()` from `useGroupedSections`: it returns the predicate (a task, not snoozed, in the context). Export it.
- `Dashboard`:
  - Queries: `viewQuery("wip", …)`, `viewQuery("waiting", …)`, and `status=open&limit=500&dueBefore=<today + 7>`, with `keepPrevious`.
  - Header: the `h1` is the date in the user's time zone, for example "Sunday 1 November". No Show completed.
  - Summary (`.dashboard-summary`): links for WIP (`/wip`), Overdue and Today (`/today`), and Inbox (`/inbox`, from `viewCount`, hidden with no Inbox list).
  - `QuickAdd` targets the Inbox with `announce`.
  - Sections, `split={2}`: **WIP** (all rows; aside `n/3`, with `wip-over` above the limit), **Overdue and today**, **This week**, **Waiting**.
  - The last three cap at `SECTION_LIMIT`. Their aside is a link to `/today` or `/waiting`; This week's is a button that expands in place.
  - `placeholder`: "Loading…", the error with Try again, or "Nothing in progress", "Nothing overdue", "Nothing this week", "Nothing waiting".
  - `rowNote`: the list name; for Waiting, the age then the list name.

**Tests first (`renderAt("/dashboard")`):** each section shows its tasks; a task is in only the first section it fits; `4/3` is marked over the limit; capping and the links; This week expands; the context narrows the sections; ticking a task removes it; one failing query leaves the others showing.

**Commit:** `Add the Dashboard screen`.

---

### Task 4: Navigation

**Files:** Modify `web/src/lib/commands.ts`, `web/src/ui/AppShell.tsx`, `web/src/ui/Sidebar.tsx`, `web/src/ui/screens.tsx`, `web/src/ui/AppShell.test.tsx`.

- Add the `goDashboard` command, `g d`, "Go to Dashboard", and `["goDashboard", "/dashboard"]` in `GO`.
- Add the `/dashboard` route before `/:view`, and make `Home` redirect there always.
- Add Dashboard as the first sidebar item.

**Tests:** `/` lands on the Dashboard; the sidebar link is marked current; `g d` goes there. Replace the two tests that expected `/` to reach Inbox or Today.

**Commit:** `Open on the Dashboard`.

---

### Task 5: Check it in the browser, then document

1. Seed tasks locally and take Playwright screenshots at desktop and phone width, light and dark, and with the panel open. Look at them.
2. Mark the design doc built, with an As built section.
3. Commit `Mark the Dashboard as built`.
4. Ask Andrew about merging and pushing.
