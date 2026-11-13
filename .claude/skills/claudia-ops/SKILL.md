---
name: claudia-ops
description: Claudia operations - backups and restores, minting API tokens, the Godspeed export and import, connecting MCP clients (claude.ai, phone, Claude Code), the iPhone capture Shortcut, and web app sign-in. Use when doing any of these.
---

# Claudia operations

Run commands from the repo root.

- Backups: a cron makes a nightly SQL dump in the R2 bucket `claudia-backups` (kept 30 days); `POST /api/backup` (admin) makes one now. CI records a D1 Time Travel bookmark before applying migrations. Restoring: `docs/backups.md`.

- `npm run token:create -w @claudia/worker -- --remote --name laptop --scopes admin`: mint an API token straight into D1 (the first admin token; later ones come from `POST /api/tokens`). The secret is shown once.

- `npm run godspeed:fetch -w @claudia/worker`: download the whole Godspeed account (needs `GODSPEED_API_KEY`; open tasks only, so under a minute. Add `--include-completed` for history, which takes about 5 minutes because of the rate limit) into the git-ignored `worker/godspeed-export/`
- `CLAUDIA_TOKEN=cl_... npm run godspeed:import -w @claudia/worker -- --url https://claudia.alphajuliet.com`: import that export through `POST /api/import` (admin token). `--dry-run` prints the report without sending. Open tasks only unless `--include-completed`. Safe to repeat: IDs are derived from Godspeed's and existing ones are skipped.

- Remote MCP: `https://claudia.alphajuliet.com/mcp`. claude.ai and the phone connect with OAuth: Settings > Connectors > Add custom connector, URL `https://claudia.alphajuliet.com/mcp`, approved on the consent page with the owner passphrase (`OWNER_PASSPHRASE`, a Worker secret). Claude Code keeps using a Claudia API token (a `read` token sees only the read tools). Add it to Claude Code with:
  `claude mcp add --transport http claudia https://claudia.alphajuliet.com/mcp --header "Authorization: Bearer $(cat ~/.config/claudia/write-token)"`

- iPhone capture: an iOS Shortcut posts one line to `POST /api/capture` (Inbox, parsed like quick add: `#labels` and a trailing date) with its own `write` token. Set-up steps: `docs/shortcut-capture.md`.

- Web app sign-in: the app asks for an API token on first use, checks it with `GET /api/me` and keeps it in the browser's `localStorage` (`claudia.token`) until Sign out. Mint one with `npm run token:create -w @claudia/worker -- --remote --name browser --scopes write`.
