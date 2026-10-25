# CLAUDE.md

Guidance for Claude when working in this repository.

## What this is

**Claudia** is Andrew's personal task manager: a replacement for Godspeed with a complete API, tailored web UIs for desktop, iPad and mobile, and a remote MCP server for AI assistants. It is served at `https://claudia.alphajuliet.com/`.

Outcomes:

1. A personal task management system, similar to Godspeed, Todoist or TickTick, for tasks across work, home and personal contexts.
2. A fully featured API for tailored web UIs and MCP access.
3. Support for Andrew's own task workflows and productivity system.

## Design reference

The design, decisions and plan are in the Obsidian note **Claudia: own task store on Cloudflare**:

- Vault path: `~/Obsidian/2026/202610251245 own-task-store.md`
- Link: `obsidian://open?vault=Obsidian&file=2026%2F202610251245%20own-task-store`

Read it before starting any feature. It links to the broader context in `2026/202610142030 task-management-reboot.md` (principles, labels, review cadence, why Godspeed fell short). If the code and the note disagree, ask which one is right, then update the other. Record new design decisions in the note as dated `#Decision` lines, not only in commit messages.

## Project tracking

Work is tracked on the Workflowy **Claudia** board (`🔅 My projects › Productivity › Claudia`, node `c5cebc351211`, https://workflowy.com/#/c5cebc351211), not in this repo.

- Columns: `BACKLOG` → `NEXT` (limit 3) → `WIP` (limit 3) → `DONE`.
- Cards are outcome-level, one line each. Detail goes in the card's note or in the Obsidian note.
- Before starting work, move the card from `NEXT` to `WIP`. When it is finished and committed, move it to `DONE`. Keep within the limits: if `WIP` is full, finish something first.
- Add newly discovered work to `BACKLOG`. Don't reorder or delete Andrew's cards without asking.
- Tags in use on the board: `#Issue`, `#Closed`, `#epic`.

## Decisions that constrain the code

- **Platform:** one Cloudflare Worker serves the REST API (`/api`), the remote MCP server (`/mcp`) and the web app (static assets). Storage is D1. Cron Triggers handle recurrence and nightly backups to R2.
- **Language:** TypeScript end to end.
- **API first:** Hono with `@hono/zod-openapi`. Zod schemas are the single source for the OpenAPI spec, the typed web client and the MCP tool definitions. Every capability the UI has must exist in the API.
- **Data:** Drizzle ORM over D1, with migrations via `wrangler d1 migrations`. IDs are ULIDs. Ordering uses fractional indexes. Deletes are soft (`deleted_at`). Every change writes a row to the append-only `events` table.
- **Domain model:** folders (with `context`: work, personal, home), lists, tasks (with `kind`: task or heading), labels, saved filters, settings, API tokens. Labels carry state (`wip`, `waitingOn`, `next`, `someday`, …).
- **Recurrence:** RRULE plus `recur_from` (`due` or `completion`). Completing a recurring task advances it in place and logs a `completed` event.
- **Keyboard:** every UI action is a registered command. The keymap lives in user settings and is editable in the app. Defaults follow Godspeed.
- **Front-end:** one responsive web app with phone, iPad and desktop layouts, installable to the home screen. Offline is limited to a capture queue and a cached Today view.
- **Auth:** Cloudflare Access (passkey) for the web app. Hashed, scoped API tokens for the iOS Shortcut, the CLI and scripts. OAuth (`workers-oauth-provider`) for the remote MCP.
- **Out of scope for day one:** timed or push notifications, full offline sync, sharing.
- Never serve from `*.workers.dev`; corporate filters may block it.

## Conventions

- Australian English in UI copy and docs. Dates are stored in UTC, and date-only fields as `YYYY-MM-DD`. The default time zone is `Australia/Sydney`.
- Small, focused commits with imperative messages.
- Never commit secrets. Use `wrangler secret` and `.dev.vars` (git-ignored).
- Tests come with features: unit tests for the domain logic (recurrence, ordering, filters) and API tests against a local D1.

## Commands

npm workspaces monorepo: `shared` (Zod schemas), `worker` (Hono API, wrangler config) and `web` (Vite + React). Run from the repo root:

- `npm install`
- `npm run dev`: build the web app, then `wrangler dev` on http://localhost:8787 (`npm run dev:web` for Vite with HMR, proxying `/api` to the Worker)
- `npm run typecheck`, `npm test`, `npm run build`
- `npm run deploy`: build and `wrangler deploy` (CI does this on push to `main`; it needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets)

Migrate commands will be added with the D1 schema.
