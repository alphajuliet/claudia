# Markdown, theme, collapse and show completed: design

Date: 2026-10-31. Status: approved; built.

Four cards from NEXT, built in this order, each with its own tests and commits.

## 1. Markdown in titles and notes

- Rendering uses `react-markdown` with `remark-gfm`. It renders to React elements, never raw HTML, so stored text can't inject markup.
- **Titles** render inline Markdown only (bold, italics, strikethrough, code, links), in rows, headings and the panel's subtasks; images, footnotes and tables are off. The panel's title field always shows the raw text. Links to other sites open in a new tab, and clicking one (or Enter on it) doesn't start a rename. Labels and messages use the plain text.
- **Notes** in the panel render full GitHub-flavoured Markdown. Clicking them (or Enter when they have focus) switches to the textarea; leaving it saves and shows them formatted again. Empty notes show a "Notes" placeholder to click. Ticking `- [ ]` checkboxes in notes is not supported yet.
- Storage, the API and MCP are unchanged: they keep the Markdown text.

## 2. Theme

- A System / Light / Dark switch in the sidebar footer, kept in this browser (`localStorage` `claudia.theme`).
- `data-theme` on `<html>`: the dark tokens apply under `prefers-color-scheme: dark` unless the theme is light, and always when it is dark.
- A small inline script in `index.html` applies the stored theme before first paint.

## 3. Collapse headings and parent tasks

- Headings and tasks with subtasks show a ▸/▾ toggle. A collapsed heading hides its section; a collapsed task hides its subtasks.
- `h` collapses the highlighted item, or moves the highlight to its parent when it is already collapsed or has no children. `l` expands it.
- Collapsed IDs are kept in this browser (`claudia.collapsed`).
- When a collapse hides the highlighted row, the highlight moves to the item collapsed.

## 4. Show completed

- On every screen (lists, Inbox, Today, Next, WIP, Waiting, Someday, saved filters), a "Show completed" button in the header and `Shift+C` toggle it; the choice is kept in this browser. (2026-10-31: widened from lists only after trying it.)
- When on, the screen fetches its completed tasks with a second query (`status=completed`; for a saved filter, `GET /api/filters/{id}/tasks?status=completed`), so they never crowd open tasks out of the limit. Today shows only tasks completed today. Completed tasks and subtasks appear in place, ticked, struck through and dimmed. Unticking one, or `x` on it, reopens it.
- Collapse still applies. Snoozed tasks stay hidden.

## Testing

Unit tests for the pure parts (theme resolution, collapse filtering of rows). Testing Library tests for rendering Markdown safely (no raw HTML), link clicks not renaming, notes edit and save, the theme switch, collapse by click and by `h`/`l`, and showing, ticking and unticking completed tasks.
