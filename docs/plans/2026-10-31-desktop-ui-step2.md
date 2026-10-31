# Desktop UI Step 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add, edit and organise tasks from the web app: quick add, inline title editing, and a detail panel (notes, dates, labels, list, repeat, subtasks, delete).

**Architecture:** New pure helpers in `web/src/lib/` (quick-add parsing, repeat presets) with unit tests. New mutations in `web/src/data/queries.ts` that update cached task lists at once and roll back on failure, reusing the per-task restore approach of `useSetCompleted`. UI in `web/src/ui/`. The selected task lives in the URL (`?task=<id>`) so reload and back work. Design: `docs/plans/2026-10-31-desktop-ui-design.md` (step 2 section).

**Tech Stack:** React 19, TanStack Query 5, wouter 3, Vitest 4 + jsdom + Testing Library.

---

Conventions: Australian English in UI copy. Small commits with imperative messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run commands from the repo root. Test fixture IDs must be valid ULIDs (no I, L, O, U). `web/src/ui/TaskList.test.tsx` has a stateful fake API to extend.

API facts (see `shared/src/schemas.ts` and `worker/src/routes/tasks.ts`):
- `POST /api/tasks` takes `TaskCreateSchema` (`listId` and `title` required; `parentId`, `labels` as names (missing ones are created), dates, `recurRule` + `recurFrom` together, `afterId`/`beforeId`; omit both to append). Returns 201 with the task.
- `PATCH /api/tasks/{id}` takes any subset of `TaskUpdateSchema`; `labels` replaces the set; `null` clears a field; `recurRule` and `recurFrom` must be set or cleared together (422 `invalid_recurrence`).
- `POST /api/tasks/{id}/move` takes `{ listId?, parentId?, afterId?, beforeId? }`.
- `DELETE /api/tasks/{id}` soft-deletes the task and its subtree (204). There is no restore endpoint, so deleting asks for confirmation.
- `GET /api/labels` lists labels.

### Task 1: Helpers and mutations

**Files:**
- Create: `web/src/lib/quickAdd.ts`, `web/src/lib/repeat.ts` (+ `.test.ts` each)
- Modify: `web/src/data/queries.ts` (+ tests in `web/src/data/queries.test.tsx`)

**`parseQuickAdd(text)`** → `{ title: string; labels: string[] }`. Words starting with `#` followed by a label name (letters, digits, `_`, `-`; match `LabelNameSchema` in shared) become labels (without `#`, deduplicated ignoring case, first spelling kept) and are removed from the title; whitespace is collapsed and trimmed. A lone `#` or `#` inside a word stays in the title. Empty title after parsing → title is the original trimmed text without parsing (so "#next" alone is a task titled "#next"). Tests cover these.

**Repeat presets** (`repeat.ts`):

```ts
export type Preset = "none" | "daily" | "weekdays" | "weekly" | "fortnightly" | "monthly" | "yearly" | "custom";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "none", label: "Doesn't repeat" }, { id: "daily", label: "Every day" }, { id: "weekdays", label: "Every weekday" },
  { id: "weekly", label: "Every week" }, { id: "fortnightly", label: "Every fortnight" }, { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" }, { id: "custom", label: "Custom…" },
];
export function ruleFor(preset: Preset): string | null; // none → null; daily → "FREQ=DAILY"; weekdays → "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"; weekly → "FREQ=WEEKLY"; fortnightly → "FREQ=WEEKLY;INTERVAL=2"; monthly → "FREQ=MONTHLY"; yearly → "FREQ=YEARLY"; custom → throws (the caller supplies the text)
export function presetFor(rule: string | null): Preset; // inverse, exact match after uppercasing; anything else (e.g. "FREQ=WEEKLY;BYDAY=SA") → "custom"
```

Plain weekly repeats on the due date's weekday because the server anchors on the due date, so no `BYDAY` is needed. Tests: round trip for every preset; the production rules `FREQ=WEEKLY;BYDAY=SA` and `FREQ=WEEKLY;INTERVAL=4` are custom.

**Mutations** (all through `useSession().api`, parse responses with shared schemas, show errors to the caller by rejecting):
- `useLabels()`: `GET /api/labels`, key `["labels"]`.
- `useCreateTask()`: POST; on success insert the new task into every cached `["tasks", ...]` list it belongs in is hard to know, so: on success invalidate `["tasks"]` (and `["labels"]` if it used labels). No optimistic insert. Returns the created task.
- `useUpdateTask()`: `{ id, patch }` → PATCH. Optimistic: replace the task in every cached list with `{ ...task, ...patch }` (labels: the new array); on error restore the old task object in the lists it was in; on success write the server's task; invalidate `["tasks"]` when it is the last running task mutation (share one `mutationKey` prefix, e.g. `["task-write"]`, with move and delete, and keep `useSetCompleted`'s own key, but the "last running" check should count all task mutations: use a common `mutationKey: ["tasks", "<kind>"]` for all four and check `isMutating({ mutationKey: ["tasks"] }) === 1`; adjust `useSetCompleted` to match and keep its tests passing). Invalidate `["labels"]` when the patch has labels.
- `useMoveTask()`: `{ id, listId?, parentId?, afterId?, beforeId? }` → POST move; no optimistic change; invalidate `["tasks"]` on settle.
- `useDeleteTask()`: `{ task }` → DELETE; optimistic removal of the task and its cached descendants (reuse the descendant walk from `useSetCompleted`); restore on error.
- Do not return invalidate promises from `onSettled` (fire and forget), as in `useSetCompleted`.

Tests: update replaces at once and rolls back on 500; delete removes a task and its subtask at once and rolls back; create invalidates so a list refetches; the "last running mutation" rule holds across an update and a completion overlapping.

Commit: "Add web helpers and mutations for editing tasks".

### Task 2: Quick add and inline title editing

**Files:** `web/src/ui/QuickAdd.tsx`, changes to `web/src/ui/screens.tsx`, `TaskList.tsx`, `TaskRow.tsx`, styles; tests in `web/src/ui/TaskList.test.tsx` or a new `web/src/ui/editing.test.tsx`.

- A quick-add field at the top of every task list screen, placeholder "Add a task", with an accessible label "Add a task". Enter submits (with `parseQuickAdd`), clears the field and keeps focus for the next one; Escape clears and blurs. Empty input does nothing. While saving, the field stays usable; failures show an error toast and put the text back.
- Where it adds:
  - List screen: that list, appended at the end.
  - Inbox, WIP, Next, Waiting, Someday: the Inbox list, with the view's label added (`wip`, `next`, `waitingOn`, `someday`; Inbox adds none).
  - Today: the Inbox list with `dueDate` = today (user time zone).
  - Saved filter: the Inbox list, no extras.
  - If there is no Inbox list, the field is hidden on views (not on list screens).
- After adding, a short toast "Added to {list name}" when the task went to a different list than the screen shows (views always say "Added to Inbox").
- Inline title edit: clicking the title (or pressing Enter when the row is focused) turns it into a text input; Enter or blur saves via `useUpdateTask` if changed and non-empty; Escape cancels. Clicking elsewhere on the row (not checkbox, not title) selects the task (Task 3).

Tests: adding in a list posts the right body and the task appears after refetch; adding in Next adds the `next` label and Inbox list; `#labels` parsed; Today sets the due date; failure restores the text; inline edit saves on Enter and cancels on Escape.

Commit: "Add quick add and inline title editing to the web app".

### Task 3: Detail panel

**Files:** `web/src/ui/TaskDetail.tsx` (+ small field components as needed), `AppShell.tsx` (third column), `TaskRow.tsx` (selection), styles; tests in `web/src/ui/TaskDetail.test.tsx`.

- Selecting a row (click on the row body, not the checkbox or title) sets `?task=<id>` on the current URL (keep the path; use wouter's `useSearch` / `navigate`); the row shows as selected (`aria-selected` or `aria-current`). The panel reads the id, finds the task in any cached list or fetches `GET /api/tasks/{id}`, and shows a close button (removes `?task`). Escape closes the panel when focus is inside it.
- Layout: a third column (about 380px) at desktop width; under 900px it is a full-height sheet over the content.
- Fields, each saving through `useUpdateTask` (or move), with a quiet "Saved" or the error message:
  - Title (text input, saves on blur or Enter).
  - Notes (textarea, saves on blur; auto-grows).
  - Due date and start date (`<input type="date">`, each with Clear). If the task has a `dueAt` but no `dueDate`, show the time read-only ("Due 3 Nov, 7:00 pm") with Clear; editing times is out of scope.
  - Labels: chips with remove buttons, and an input with suggestions from `useLabels()` (a `<datalist>` is enough); Enter adds; new names are created by the server.
  - List: a `<select>` of live lists grouped by folder (`<optgroup>`), in sidebar order (`sidebarTree` with context "all"); changing it calls `useMoveTask` with `listId` (the server appends; nesting is cleared by the server if needed — check `worker/src/routes/tasks.ts` move logic and make the UI match).
  - Repeat: a `<select>` of `PRESETS`; "Custom…" shows a text input for the RRULE (pre-filled with the current rule); a "From due date" / "From completion" radio pair shown when repeating. Saving sends `recurRule` and `recurFrom` together (default `due` when turning repeat on); "Doesn't repeat" sends both null. A 422 shows the server's message next to the field.
  - Subtasks: the task's children (from `GET /api/tasks?parentId={id}&status=open`), each with a checkbox (uses the same completion as rows, with toasts), and an "Add a subtask" field that creates with `parentId` and the same `listId`.
  - Delete: a "Delete task" button that asks `window.confirm("Delete “{title}” and its subtasks? This can't be undone.")`, then deletes, closes the panel and shows "Deleted “{title}”".
- Headings: selecting a heading shows only title and delete.

Tests: selecting a row puts `?task=` in the URL and opens the panel; editing notes PATCHes on blur; changing due date PATCHes `dueDate`; Clear sends null; adding and removing a label PATCHes the full label array; choosing "Every week" sends `recurRule: "FREQ=WEEKLY", recurFrom: "due"`; "Doesn't repeat" sends both null; a 422 shows its message; changing list POSTs move; adding a subtask POSTs with `parentId`; delete asks and then DELETEs (stub `window.confirm`); Escape and the close button remove `?task`.

Commit: "Add the task detail panel to the web app".

### Task 4: Review, docs and hands-on

- Independent review of Tasks 1–3; fix findings.
- README line: adding, editing and the detail panel.
- Andrew pushes and tries it: quick add in a list and in Next, `#labels`, editing a title, the panel fields, a repeat preset, moving between lists, subtasks, delete.
- `#Decision` line in the Obsidian note (quick-add targets per view, `#label` parsing, repeat presets, delete with confirm and no undo). Add "Restore deleted tasks (undo delete)" to BACKLOG.
