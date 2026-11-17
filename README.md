# Claudia

A personal task manager with a complete API, built on Cloudflare Workers and D1.

Claudia keeps work, home and personal tasks in one place. It is built API-first, so the web UIs for desktop, iPad and phone, the iOS Shortcut, email capture, the CLI and AI assistants (through MCP) all use the same interface.

> **Status:** in daily use at `https://claudia.alphajuliet.com`, and still in active development.

## Features

- **Folders, lists and labels**, with work, personal and home contexts. Status labels (`next`, `waitingOn`, `wip`, `recurring`, `onHold`, `someday`) are one to a task.
- **Built-in views** (Inbox, Today, Next, WIP, Waiting, Someday) and a dashboard: WIP against a limit of three per context, overdue and today, waiting, the next 3 days, and (on desktop) a chart of open tasks by status.
- **A search language** (Lucene-style: `folder:Work (#wip OR due:<=today) sort:due`), and smart views: saved searches with their sort and grouping, kept in any folder. The built-in views are search queries too.
- **Recurring tasks.** RRULE-based, repeating from the due date or from completion.
- **Keyboard shortcuts.** Every action is a command with default keys that follow Godspeed.
- **One responsive web app.** Phone, iPad and desktop layouts, installable to the home screen, with swipes and shake to undo on touch screens.
- **A complete REST API** with an OpenAPI spec, including update and move, which many hosted task managers lack.
- **A remote MCP server** so AI assistants can read and change tasks.
- **Capture from anywhere:** an iOS Shortcut, and email to the Inbox address, which Claude reads into a task.
- **A full change history.** Every change is written to an append-only event log.

Still to come: an editable keymap, offline capture and a cached Today, and an API for the change history. Not planned: push or timed notifications, full offline sync, and sharing.

## Architecture

One Cloudflare Worker serves everything:

| Path | Purpose |
|---|---|
| `/api` | REST API (Hono, with the OpenAPI spec generated from Zod schemas) |
| `/mcp` | Remote MCP server (Cloudflare Agents SDK, OAuth) |
| `/` | Web app (Vite + React, served as static assets) |

Data lives in D1 (SQLite), accessed through Drizzle ORM. Cron Triggers handle nightly backups to R2; recurrence advances when a task is completed, not on a schedule. The API is protected by scoped API tokens, which the web app, scripts and the iOS Shortcut all use. The remote MCP uses OAuth with an owner passphrase.

The web app asks for an API token the first time you open it, checks it with `GET /api/me`, and keeps it in the browser's local storage until you sign out. Mint one for the browser with `npm run token:create -w @claudia/worker -- --remote --name browser --scopes write` (the secret is shown once). Signed in, it shows the dashboard, the built-in views (Inbox, Today, Next, WIP, Waiting, Someday), your smart views and every list, with a count of open tasks beside each view and list (from `GET /api/counts`), narrowed by context (Work, Personal, Home), and you can complete tasks with Undo. Add tasks from any screen (`#label` adds a label), click a title to rename it (a list's title on its screen, or double-click a list or folder in the sidebar), and click a row to open the detail panel for notes, dates, priority, status, labels, list, repeat, subtasks and delete. Lists and folders are created, and lists, folders and smart views renamed, moved and deleted, from their ⋯ menus in the sidebar (or by dragging), and labels (including which are status labels, and their order) on the Labels screen. Titles and notes take Markdown (inline marks in titles, GitHub-flavoured Markdown in notes). Headings and tasks with subtasks collapse, every screen can show completed tasks (Show completed, or `Shift+C`), and the theme is System, Light or Dark (set in the sidebar). Search takes the search language, with Sort and Group menus and a **?** cheat sheet, and Save as smart view keeps a search. Everything also works from the keyboard: `j`/`k` move through tasks, `h`/`l` collapse and expand, Enter opens one, `x` completes, `e` renames, Delete or Backspace deletes (after asking), `c` adds, `/` searches, `g t` (and `g d`, `g i`, `g n`, `g w`, `g o`, `g s`, `g #`) goes to a view, and `?` lists every shortcut.

## Development

Requires Node.js 22 or later. This is an npm workspaces monorepo (`shared`, `worker`, `web`).

```sh
npm install
npm run dev    # builds the web app and serves everything at http://localhost:8787
```

For local runs, create `worker/.dev.vars` (git-ignored) with the owner passphrase that gates the MCP OAuth consent page:

```sh
OWNER_PASSPHRASE=choose-a-local-passphrase
```

Production uses a Worker secret of the same name, set with `wrangler secret put OWNER_PASSPHRASE`. Tests set their own value (`test-passphrase`) in `worker/vitest.config.ts`.

See `CLAUDE.md` for the full list of commands.

## Licence

[MIT](LICENSE)
