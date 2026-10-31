# Desktop daily driver: design

Date: 2026-10-31. Status: approved; steps 1 to 3 built.

The first real web UI. It replaces the signed-in placeholder with a three-pane desktop app that later phone and iPad layouts reuse. Godspeed is the reference for look and keys.

## Layout

- **Sidebar (left).**
  - Built-in views, in this order: Inbox, Today, Next, WIP, Waiting, Someday.
  - The user's saved filters (`GET /api/filters`) below them, in their stored order.
  - Folders and lists as a collapsible tree (archived lists hidden).
  - A context switch (All, Work, Personal, Home) that narrows both the tree and every view. The choice is remembered in the browser.
  - Sign out at the bottom.
- **Task list (centre).** Each row has a checkbox, title, label chips and the due date shown relatively ("Today", "Tomorrow", "Fri", "3 Nov"; overdue in red). In a list, rows follow list order with subtasks indented and headings as section titles. In a view, rows group under their list's name, lists in sidebar order.
- **Detail panel (right).** Built in step 2.

## Views

All views show open tasks only and hide tasks snoozed until a future time.

| View | Query |
|------|-------|
| Inbox | the list named `Inbox` (case-insensitive); hidden if there is none |
| Today | `dueBefore=<today>` (includes overdue) |
| Next | `label=next` |
| WIP | `label=wip` |
| Waiting | `label=waitingOn` |
| Someday | `label=someday` |
| Saved filter | `GET /api/filters/{id}/tasks` |
| List | `listId=<id>` |

"Today" is the date in the `timeZone` setting (default `Australia/Sydney`). Built-in views live in code, not as seeded saved filters, so nothing changes in the database. Views fetch up to 500 tasks, the API maximum.

## URLs

`/inbox`, `/today`, `/next`, `/wip`, `/waiting`, `/someday`, `/filter/:id`, `/list/:id`. `/` redirects to `/inbox`. Routing uses `wouter`. The Worker already serves the app for any unknown path (single-page fallback).

## Actions

- **Step 1:** complete a task from its checkbox. The row updates at once and rolls back if the server refuses. A plain task leaves the list and a toast offers Undo (uncomplete). A repeating task stays and shows its new due date ("Next due Sat 7 Nov").
- **Step 2:** quick add, inline title edit, detail panel (notes, due and start dates, labels, list, repeat presets with from-due or from-completion, subtasks).
- **Step 3:** keyboard commands through a minimal command registry (`j`/`k`, `x`, `e`, `c`, `/`, `g` chords). Palette and keymap editor stay on their own card.

## Technical

- TanStack Query for all server state, through the session's `api()` so a 401 signs out. Responses are parsed with the shared Zod schemas.
- Hand-written CSS with custom properties, light and dark from `prefers-color-scheme`. No component library.
- Responsive from the start: below about 900px the sidebar becomes a drawer behind a menu button. No phone-specific design yet.
- Pure logic (task tree, grouping, relative dates, view queries) lives in `web/src/lib/` with unit tests; screens get Testing Library tests with a mocked `fetch`.

## Out of scope

Drag-and-drop reordering, command palette, keymap editor, board, weekly review, offline.
