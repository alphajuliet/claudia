# Backups and restoring

Claudia's data is the D1 database `claudia`. There are two ways back from a mistake:

| | What | When | Kept |
|---|---|---|---|
| **Time Travel** | D1's own point-in-time restore of the whole database | Any minute, and a bookmark is recorded before every CI migration | 30 days on the Workers Paid plan, 7 on Free |
| **Nightly backup** | The whole database as one SQL file in the R2 bucket `claudia-backups` | 16:00 UTC (3 am Sydney in summer, 2 am in winter), from the Worker's cron | 30 days (R2 lifecycle rule on `nightly/`) |

Time Travel is quickest for "undo the last hour". The nightly SQL file is a copy outside D1, and it can be restored into a different database to look at before touching production.

Not backed up: OAuth grants (in KV; reconnect claude.ai and the phone if lost) and Worker secrets (`OWNER_PASSPHRASE`; set it again with `wrangler secret put`).

## The nightly backup

`worker/src/backup.ts` reads every table and writes `nightly/claudia-YYYY-MM-DD.sql`:

1. `PRAGMA defer_foreign_keys = true;`, then each `CREATE TABLE`
2. one `INSERT` per row (line breaks in text are written as `char(10)`, so each row is one line)
3. the indexes and triggers, after the rows, so the append-only triggers on `events` don't get in the way

`d1_migrations` is included, so a restored database knows which migrations it has. Cloudflare's own tables (`_cf_KV`, `sqlite_sequence`) are left out. The object's metadata holds the row count per table.

The rows are read table by table while the database is live, so a change made during the backup (at 3 am) may be half in it. Time Travel has no such gap.

Make one now (it replaces today's file), with an admin token:

```sh
curl -X POST https://claudia.alphajuliet.com/api/backup -H "Authorization: Bearer $(cat ~/.config/claudia/admin-token)"
```

If a nightly run fails, it shows in the Worker's logs (Workers & Pages › claudia › Logs, filtered to the cron).

List and fetch backups:

```sh
cd worker
npx wrangler r2 object get claudia-backups/nightly/claudia-2026-11-08.sql --remote --file /tmp/claudia.sql
```

## Restoring

### From Time Travel (in place)

This **overwrites** the production database, losing every change after the chosen moment.

```sh
cd worker
npx wrangler d1 time-travel info claudia --timestamp 2026-11-08T05:00:00Z   # the bookmark for a moment
npx wrangler d1 time-travel restore claudia --bookmark=<bookmark>
```

Each deploy's GitHub Actions summary shows the exact restore command for the moment just before its migrations ran.

### From a nightly backup

Restore into a new, empty database first and check it:

```sh
cd worker
npx wrangler r2 object get claudia-backups/nightly/claudia-2026-11-08.sql --remote --file /tmp/claudia.sql
npx wrangler d1 create claudia-restore --location oc
npx wrangler d1 execute claudia-restore --remote --file /tmp/claudia.sql
npx wrangler d1 execute claudia-restore --remote --command "SELECT count(*) FROM tasks WHERE deleted_at IS NULL"
```

The file creates its tables, so it only runs into an empty database. To use the restored copy, point the Worker at it: change `database_name` and `database_id` in `wrangler.jsonc` to the new database's and deploy. Otherwise delete it when done: `npx wrangler d1 delete claudia-restore`.
