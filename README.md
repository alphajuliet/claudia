# Claudia

A personal task manager with a complete API, built on Cloudflare Workers and D1.

Claudia keeps work, home and personal tasks in one place. It is built API-first, so the web UIs for desktop, iPad and phone, the iOS Shortcut, the CLI and AI assistants (through MCP) all use the same interface.

> **Status:** early development. Nothing is deployed yet.

## Features

Planned for the first release:

- **Folders, lists and labels.** Labels carry state (`next`, `wip`, `waitingOn`, `someday`, …), and saved filters act as smart lists.
- **Recurring tasks.** RRULE-based, repeating from the due date or from completion.
- **Customisable keyboard shortcuts.** Every action is a command, with a command palette and an editable keymap that syncs across devices.
- **One responsive web app.** Phone, iPad and desktop layouts, installable to the home screen, with an offline capture queue.
- **A complete REST API** with an OpenAPI spec, including update and move, which many hosted task managers lack.
- **A remote MCP server** so AI assistants can read and change tasks.
- **A full change history.** An append-only event log supports undo, "done this week" and staleness checks.

Not planned for day one: push or timed notifications, full offline sync, and sharing.

## Architecture

One Cloudflare Worker serves everything:

| Path | Purpose |
|---|---|
| `/api` | REST API (Hono, with the OpenAPI spec generated from Zod schemas) |
| `/mcp` | Remote MCP server (Cloudflare Agents SDK, OAuth) |
| `/` | Web app (Vite + React, served as static assets) |

Data lives in D1 (SQLite), accessed through Drizzle ORM. Cron Triggers handle recurrence and nightly backups to R2. The API is protected by scoped API tokens, which the web app, scripts and the iOS Shortcut all use. The remote MCP uses OAuth with an owner passphrase.

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

Production uses a Worker secret of the same name. Tests set their own value (`test-passphrase`) in `worker/vitest.config.ts`.

See `CLAUDE.md` for the full list of commands.

## Licence

[MIT](LICENSE)
