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

interface ForeignKey { tbl: string; ref: string; from: string; to: string }

/**
 * Tables so each comes after the tables it refers to (a reference to itself aside), keeping their order otherwise.
 * A cycle between tables leaves the rest in their order.
 */
export function tablesInOrder(names: string[], keys: ForeignKey[]): string[] {
  const out: string[] = [];
  let pending = names;
  while (pending.length) {
    const ready = pending.filter((t) => keys.every((k) => k.tbl !== t || k.ref === t || !pending.includes(k.ref)));
    const next = ready.length ? ready : [pending[0]!];
    out.push(...next);
    pending = pending.filter((t) => !next.includes(t));
  }
  return out;
}

/**
 * Rows so a row comes after the row it refers to through `from` → `to` in the same table (a task after its parent).
 * Rows whose parent isn't there (or a cycle) keep their place at the end.
 */
export function parentsFirst(rows: Record<string, unknown>[], from: string, to: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const placed = new Set<unknown>();
  const ids = new Set(rows.map((r) => r[to]));
  let pending = rows;
  while (pending.length) {
    const ready = pending.filter((r) => r[from] === null || r[from] === undefined || !ids.has(r[from]) || placed.has(r[from]));
    const next = ready.length ? ready : pending;
    for (const r of next) {
      out.push(r);
      placed.add(r[to]);
    }
    pending = pending.filter((r) => !next.includes(r));
  }
  return out;
}

/**
 * The schema and every row, as statements: tables, then rows (each after any row it refers to), then indexes and
 * triggers (so the append-only triggers don't see the inserts).
 * `d1_migrations` is included, so a restored database knows which migrations it has.
 */
export async function dumpDatabase(db: D1Database, at = new Date()): Promise<Dump> {
  const { results: master } = await db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
    .all<MasterRow>();
  const unordered = master.filter((m) => m.type === "table" && !SKIP.test(m.name));
  // Table by table: Cloudflare's own tables can't be looked into.
  const keys: ForeignKey[] = [];
  for (const t of unordered) {
    const { results } = await db.prepare(`SELECT "table" AS ref, "from", "to" FROM pragma_foreign_key_list(?)`).bind(t.name).all<Omit<ForeignKey, "tbl">>();
    keys.push(...results.map((k) => ({ ...k, tbl: t.name })));
  }
  // Rows are written so every reference points back to a row already written: a restore may not run the file as one
  // transaction, so deferring the foreign key checks isn't enough on its own.
  const tables = tablesInOrder(unordered.map((t) => t.name), keys).map((name) => unordered.find((t) => t.name === name)!);
  const later = master.filter((m) => (m.type === "index" || m.type === "trigger" || m.type === "view") && !SKIP.test(m.tbl_name));

  const out: string[] = [
    `-- Claudia backup, ${at.toISOString()}`,
    "-- Restore into an empty database: wrangler d1 execute <name> --remote --file <this file>",
    "PRAGMA defer_foreign_keys = true;",
  ];
  for (const t of tables) out.push(`${t.sql};`);

  const rows: Record<string, number> = {};
  for (const t of tables) {
    // A stable order to page through: rowid, or the primary key for a table without one.
    const order = /WITHOUT\s+ROWID/i.test(t.sql ?? "") ? "1" : "rowid";
    let all: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await db.prepare(`SELECT * FROM ${quoted(t.name)} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(PAGE, offset).all<Record<string, unknown>>();
      all.push(...results);
      if (results.length < PAGE) break;
    }
    for (const k of keys.filter((k) => k.tbl === t.name && k.ref === t.name)) all = parentsFirst(all, k.from, k.to);
    for (const r of all) {
      const columns = Object.keys(r);
      out.push(`INSERT INTO ${quoted(t.name)} (${columns.map(quoted).join(", ")}) VALUES (${columns.map((c) => literal(r[c])).join(", ")});`);
    }
    rows[t.name] = all.length;
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
