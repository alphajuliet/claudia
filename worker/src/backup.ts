/**
 * Nightly backups: the whole database as one SQL file in R2, which restores into an empty D1 database with
 * `wrangler d1 execute <db> --remote --file <dump>.sql`. See docs/backups.md.
 */

/** Cloudflare's own tables and SQLite's: D1 makes them, and `_cf_KV` can't be read. */
const SKIP = /^(_cf_|sqlite_)/;
/** Rows read per query, well inside D1's limits. */
const PAGE = 500;

/** Under this prefix; R2's lifecycle rule for it deletes backups after 30 days. */
export const BACKUP_PREFIX = "nightly/";

interface MasterRow { type: string; name: string; tbl_name: string; sql: string | null }

/** A value as an SQL literal, on one line. */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return `X'${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  // Line breaks as char() calls, so every statement stays on one line.
  const parts = String(v).replace(/'/g, "''").split(/(\r\n|\r|\n)/);
  return parts.map((p, i) => (i % 2 ? p.split("").map((ch) => `char(${ch.charCodeAt(0)})`).join(" || ") : `'${p}'`)).join(" || ");
}

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface Dump { sql: string; rows: Record<string, number> }

/**
 * The schema and every row, as statements: tables, then rows (foreign keys checked at the end, so the order of
 * rows doesn't matter), then indexes and triggers (so the append-only triggers don't see the inserts).
 * `d1_migrations` is included, so a restored database knows which migrations it has.
 */
export async function dumpDatabase(db: D1Database, at = new Date()): Promise<Dump> {
  const { results: master } = await db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
    .all<MasterRow>();
  const tables = master.filter((m) => m.type === "table" && !SKIP.test(m.name));
  const later = master.filter((m) => (m.type === "index" || m.type === "trigger" || m.type === "view") && !SKIP.test(m.tbl_name));

  const out: string[] = [
    `-- Claudia backup, ${at.toISOString()}`,
    "-- Restore into an empty database: wrangler d1 execute <name> --remote --file <this file>",
    "PRAGMA defer_foreign_keys = true;",
  ];
  for (const t of tables) out.push(`${t.sql};`);

  const rows: Record<string, number> = {};
  for (const t of tables) {
    let count = 0;
    // A stable order to page through: rowid, or the primary key for a table without one.
    const order = /WITHOUT\s+ROWID/i.test(t.sql ?? "") ? "1" : "rowid";
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await db.prepare(`SELECT * FROM ${quoted(t.name)} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(PAGE, offset).all<Record<string, unknown>>();
      for (const r of results) {
        const columns = Object.keys(r);
        out.push(`INSERT INTO ${quoted(t.name)} (${columns.map(quoted).join(", ")}) VALUES (${columns.map((c) => literal(r[c])).join(", ")});`);
      }
      count += results.length;
      if (results.length < PAGE) break;
    }
    rows[t.name] = count;
  }
  for (const m of later) out.push(`${m.sql};`);
  return { sql: `${out.join("\n")}\n`, rows };
}

/** The object key for a backup made at `at`: one a day, so a second run that day replaces the first. */
export const backupKey = (at: Date) => `${BACKUP_PREFIX}claudia-${at.toISOString().slice(0, 10)}.sql`;

export interface BackupResult { key: string; bytes: number; rows: Record<string, number> }

/** Dumps the database into the backups bucket. */
export async function backUp(env: Pick<Cloudflare.Env, "DB" | "BACKUPS">, at = new Date()): Promise<BackupResult> {
  const dump = await dumpDatabase(env.DB, at);
  const key = backupKey(at);
  const body = new TextEncoder().encode(dump.sql);
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/sql; charset=utf-8" },
    customMetadata: { rows: JSON.stringify(dump.rows), madeAt: at.toISOString() },
  });
  return { key, bytes: body.byteLength, rows: dump.rows };
}
