/**
 * The search language: Lucene-style queries parsed by liqe, checked against Claudia's fields and compiled to SQL. See
 * docs/plans/2026-11-16-search-language-design.md. liqe only parses; what each field means is written here, reusing
 * the conditions the views use (`dueBy`, `hasLabel`, `notSnoozed`).
 *
 * A query chooses tasks. `sort:` and `group:` at its top level are lifted out as settings, and anywhere else are an
 * error. Unless the query says otherwise it shows open, unsnoozed tasks (not headings) in the context's lists.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { parse, SyntaxError as LiqeSyntaxError, type ExpressionToken, type ParserAst, type TagToken } from "liqe";
import {
  CONTEXTS,
  DEFAULT_GROUP,
  DEFAULT_SORT,
  formatGroup,
  formatSort,
  PRIORITIES,
  parseGroup,
  parseSort,
  type ContextFilter,
  type SearchGroup,
  type SearchSort,
} from "@claudia/shared";
import { folders, labels, lists, taskLabels, tasks } from "../db/schema";
import type { Db } from "../lib/db";
import type { Column } from "drizzle-orm";
import { ApiError } from "../lib/errors";
import { addDays, startOfDayIn, todayIn, userTimeZone } from "../lib/recurrence";
import { fetchTasks, hasLabel, notSnoozed } from "./tasks";

export interface SearchInput {
  q: string;
  context: ContextFilter;
  status?: "open" | "completed" | "all";
  sort?: string;
  group?: string;
  limit: number;
  offset: number;
}

/** A query error, with the column (from 1) it was found at. */
const invalid = (message: string, column: number) => new ApiError(422, "invalid_query", `${message} (column ${column})`, [{ column }]);
const columnOf = (node: { location?: { start: number } }) => (node.location?.start ?? 0) + 1;

/**
 * The lists a context covers, as the sidebar shows them: lists in no folder, lists in the context's folders (a
 * folder of another context hides what's under it), and the Inbox. Archived lists are left out. Null for "all".
 */
export async function listsInContext(db: Db, context: ContextFilter, inboxId: string | null): Promise<string[] | null> {
  if (context === "all") return null;
  const [allFolders, allLists] = await Promise.all([
    db.select({ id: folders.id, parentId: folders.parentId, context: folders.context }).from(folders).where(isNull(folders.deletedAt)),
    db.select({ id: lists.id, folderId: lists.folderId }).from(lists).where(and(isNull(lists.deletedAt), isNull(lists.archivedAt))),
  ]);
  const shown = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const f of allFolders) {
      if (f.parentId === parentId && f.context === context) {
        shown.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(null);
  const ids = allLists.filter((l) => l.folderId === null || shown.has(l.folderId)).map((l) => l.id);
  return inboxId && !ids.includes(inboxId) ? [inboxId, ...ids] : ids;
}

// ---- Dates

const addMonths = (date: string, months: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
};

const shift = (date: string, n: number, unit: string) => (unit === "m" ? addMonths(date, n) : addDays(date, unit === "w" ? n * 7 : n));

/**
 * A date word as a day: `today`, `tomorrow`, `yesterday`, `7d` / `2w` / `3m` from today, `today+7d`, `today-7d`, or
 * `YYYY-MM-DD`. Null if it isn't one.
 */
export function resolveDate(word: string, today: string): string | null {
  const w = word.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return Number.isNaN(Date.parse(`${w}T00:00:00Z`)) ? null : w;
  const named: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1 };
  if (w in named) return addDays(today, named[w]!);
  const m = /^(?:(today|tomorrow|yesterday)?([+-]))?(\d{1,4})([dwm])$/.exec(w);
  if (!m) return null;
  // A bare offset (`7d`) is from today; `+`/`-` need a day before them, since liqe can't read an unquoted `-7d`.
  if (m[2] && !m[1]) return null;
  const base = addDays(today, named[m[1] ?? "today"]!);
  return shift(base, (m[2] === "-" ? -1 : 1) * Number(m[3]), m[4]!);
}

type Op = "=" | "<" | "<=" | ">" | ">=";

/** A day comparison on a column: a date column (`YYYY-MM-DD`) directly, a timestamp by its day in the time zone. */
function dayCompare(column: Column, kind: "date" | "time", op: Op, day: string, timeZone: string): SQL {
  if (kind === "date") return { "=": eq, "<": lt, "<=": lte, ">": gt, ">=": gte }[op](column, day);
  const start = startOfDayIn(day, timeZone).toISOString();
  const end = startOfDayIn(addDays(day, 1), timeZone).toISOString();
  switch (op) {
    case "=": return and(gte(column, start), lt(column, end))!;
    case "<": return lt(column, start);
    case "<=": return lt(column, end);
    case ">": return gte(column, end);
    case ">=": return gte(column, start);
  }
}

const DATE_FIELDS = {
  due: [[tasks.dueDate, "date"], [tasks.dueAt, "time"]],
  start: [[tasks.startDate, "date"]],
  snoozed: [[tasks.snoozedUntil, "time"]],
  completed: [[tasks.completedAt, "time"]],
  created: [[tasks.createdAt, "time"]],
  updated: [[tasks.updatedAt, "time"]],
} as const;
type DateField = keyof typeof DATE_FIELDS;

// ---- What a query can say

const FIELDS = ["label", "list", "folder", "context", "priority", "is", "has", ...Object.keys(DATE_FIELDS), "sort", "group"];
const IS_VALUES = ["open", "completed", "snoozed", "available", "recurring", "heading", "subtask", "inbox"] as const;
const HAS_VALUES = ["due", "start", "notes", "labels", "status", "parent", "subtask"] as const;
const PRIORITY_RANK = { low: 0, normal: 1, high: 2 } as const;

/** The live folders and lists, for matching names. */
interface Names {
  folders: { id: string; name: string; parentId: string | null }[];
  lists: { id: string; name: string; folderId: string | null }[];
}

export interface Scope {
  today: string;
  timeZone: string;
  now: string;
  inboxId: string | null;
  names: Names;
}

/** A name without a leading emoji or symbol, in lower case: "🛠️ Renovations" is "renovations". */
const plainName = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();

/** A name matcher: whole name, ignoring case and a leading emoji; `*` and `?` are wildcards unless quoted. */
function nameMatcher(value: string, quoted: boolean): (name: string) => boolean {
  const wanted = value.trim().toLowerCase();
  if (quoted || !/[*?]/.test(wanted)) return (name) => name.toLowerCase() === wanted || plainName(name) === plainName(wanted);
  const pattern = new RegExp(`^${wanted.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "u");
  return (name) => pattern.test(name.toLowerCase()) || pattern.test(plainName(name));
}

/** A LIKE pattern for `*` and `?` wildcards. */
const likePattern = (value: string) => value.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%").replace(/\?/g, "_");

const inListIds = (ids: string[]) => (ids.length ? inArray(tasks.listId, ids) : sql`0`);

function literal(tag: TagToken, field: string): { value: string; quoted: boolean } {
  const e: ExpressionToken = tag.expression;
  if (e.type === "LiteralExpression" && e.value !== null && e.value !== "") return { value: String(e.value), quoted: e.quoted };
  if (e.type === "RegexExpression") throw invalid(`${field}: can't take a regular expression`, columnOf(tag));
  if (e.type === "RangeExpression") throw invalid(`${field}: can't take a range`, columnOf(tag));
  throw invalid(`${field}: needs a value`, columnOf(tag));
}

/** For fields that only match (`label:x`), not compare. */
function onlyMatch(tag: TagToken, field: string) {
  if (tag.operator.operator !== ":" && tag.operator.operator !== ":=") throw invalid(`${field}: can't be compared with < or >`, columnOf(tag));
}

const opOf = (tag: TagToken): Op => ({ ":": "=", ":=": "=", ":<": "<", ":<=": "<=", ":>": ">", ":>=": ">=" } as const)[tag.operator.operator];

function dateCondition(tag: TagToken, field: DateField, scope: Scope): SQL {
  const columns = DATE_FIELDS[field];
  const day = (word: string | number) => {
    const d = resolveDate(String(word), scope.today);
    if (!d) throw invalid(`${field}: needs a date such as today, tomorrow, 7d, today-7d or 2026-11-20, not "${word}"`, columnOf(tag));
    return d;
  };
  const compare = (op: Op, d: string) => or(...columns.map(([c, kind]) => dayCompare(c, kind, op, d, scope.timeZone)))!;
  const e = tag.expression;
  if (e.type === "RangeExpression") {
    const { min, max, minInclusive, maxInclusive } = e.range;
    return and(compare(minInclusive ? ">=" : ">", day(min)), compare(maxInclusive ? "<=" : "<", day(max)))!;
  }
  return compare(opOf(tag), day(literal(tag, field).value));
}

function priorityCondition(tag: TagToken): SQL {
  const { value } = literal(tag, "priority");
  const p = value.toLowerCase();
  if (!(PRIORITIES as readonly string[]).includes(p)) throw invalid(`priority: is low, normal or high, not "${value}"`, columnOf(tag));
  const rank = PRIORITY_RANK[p as keyof typeof PRIORITY_RANK];
  const test = { "=": (r: number) => r === rank, "<": (r: number) => r < rank, "<=": (r: number) => r <= rank, ">": (r: number) => r > rank, ">=": (r: number) => r >= rank }[opOf(tag)];
  return inListOrNone(tasks.priority, PRIORITIES.filter((x) => test(PRIORITY_RANK[x])));
}

const inListOrNone = (column: typeof tasks.priority, values: string[]) => (values.length ? inArray(column, values as (typeof PRIORITIES)[number][]) : sql`0`);

function isCondition(tag: TagToken, scope: Scope): SQL {
  onlyMatch(tag, "is");
  const { value } = literal(tag, "is");
  switch (value.toLowerCase() as (typeof IS_VALUES)[number]) {
    case "open": return isNull(tasks.completedAt);
    case "completed": return isNotNull(tasks.completedAt);
    case "snoozed": return sql`${tasks.snoozedUntil} > ${scope.now}`;
    case "available": return and(isNull(tasks.completedAt), notSnoozed(scope.now), or(isNull(tasks.startDate), lte(tasks.startDate, scope.today)))!;
    case "recurring": return isNotNull(tasks.recurRule);
    case "heading": return eq(tasks.kind, "heading");
    case "subtask": return isNotNull(tasks.parentId);
    // In the list flagged as the Inbox, whatever it's called.
    case "inbox": return scope.inboxId ? eq(tasks.listId, scope.inboxId) : sql`0`;
    default: throw invalid(`is: is one of ${IS_VALUES.join(", ")}, not "${value}"`, columnOf(tag));
  }
}

function hasCondition(tag: TagToken): SQL {
  onlyMatch(tag, "has");
  const { value } = literal(tag, "has");
  switch (value.toLowerCase() as (typeof HAS_VALUES)[number]) {
    case "due": return or(isNotNull(tasks.dueDate), isNotNull(tasks.dueAt))!;
    case "start": return isNotNull(tasks.startDate);
    case "notes": return sql`coalesce(${tasks.notes}, '') <> ''`;
    case "labels": return sql`EXISTS (SELECT 1 FROM ${taskLabels} tl WHERE tl.task_id = ${tasks.id})`;
    case "status":
      return sql`EXISTS (SELECT 1 FROM ${taskLabels} tl JOIN ${labels} l ON l.id = tl.label_id WHERE tl.task_id = ${tasks.id} AND l.status_position IS NOT NULL AND l.deleted_at IS NULL)`;
    case "parent": return isNotNull(tasks.parentId);
    // At least one open subtask: completed ones are hidden in lists, so a task with only those reads as done.
    case "subtask":
      return sql`EXISTS (SELECT 1 FROM ${tasks} sub WHERE sub.parent_id = ${tasks.id} AND sub.completed_at IS NULL AND sub.deleted_at IS NULL)`;
    default: throw invalid(`has: is one of ${HAS_VALUES.join(", ")}, not "${value}"`, columnOf(tag));
  }
}

function labelCondition(tag: TagToken, value: string, quoted: boolean): SQL {
  if (quoted || !/[*?]/.test(value)) return hasLabel(value);
  return sql`EXISTS (SELECT 1 FROM ${taskLabels} tl JOIN ${labels} l ON l.id = tl.label_id WHERE tl.task_id = ${tasks.id} AND lower(l.name) LIKE lower(${likePattern(value)}) ESCAPE '\\')`;
}

function folderCondition(tag: TagToken, scope: Scope): SQL {
  const { value, quoted } = literal(tag, "folder");
  const match = nameMatcher(value, quoted);
  const ids = new Set(scope.names.folders.filter((f) => match(f.name)).map((f) => f.id));
  // Subfolders too.
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of scope.names.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
  }
  return inListIds(scope.names.lists.filter((l) => l.folderId && ids.has(l.folderId)).map((l) => l.id));
}

function textCondition(value: string): SQL {
  return sql`(instr(lower(${tasks.title}), lower(${value})) > 0 OR instr(lower(coalesce(${tasks.notes}, '')), lower(${value})) > 0)`;
}

async function tagCondition(db: Db, tag: TagToken, scope: Scope): Promise<SQL> {
  if (tag.field.type === "ImplicitField") {
    const { value, quoted } = literal(tag, "search");
    // `#next` is `label:next`.
    if (!quoted && value.startsWith("#") && value.length > 1) return labelCondition(tag, value.slice(1), false);
    return textCondition(value);
  }
  const field = tag.field.name.toLowerCase();
  switch (field) {
    case "label": {
      onlyMatch(tag, field);
      const { value, quoted } = literal(tag, field);
      return labelCondition(tag, value.replace(/^#/, ""), quoted);
    }
    case "list": {
      onlyMatch(tag, field);
      const { value, quoted } = literal(tag, field);
      const match = nameMatcher(value, quoted);
      return inListIds(scope.names.lists.filter((l) => match(l.name)).map((l) => l.id));
    }
    case "folder":
      onlyMatch(tag, field);
      return folderCondition(tag, scope);
    case "context": {
      onlyMatch(tag, field);
      const { value } = literal(tag, field);
      const context = value.toLowerCase();
      if (!(CONTEXTS as readonly string[]).includes(context)) throw invalid(`context: is ${CONTEXTS.join(", ")}, not "${value}"`, columnOf(tag));
      return inListIds((await listsInContext(db, context as ContextFilter, scope.inboxId)) ?? []);
    }
    case "priority": return priorityCondition(tag);
    case "is": return isCondition(tag, scope);
    case "has": return hasCondition(tag);
    case "sort":
    case "group":
      throw invalid(`${field}: goes at the top level of the query, not inside brackets or after OR or NOT`, columnOf(tag));
    default:
      if (field in DATE_FIELDS) return dateCondition(tag, field as DateField, scope);
      throw invalid(`There's no field "${tag.field.name}". Try ${FIELDS.filter((f) => f !== "sort" && f !== "group").join(", ")}`, columnOf(tag));
  }
}

async function compile(db: Db, node: ParserAst, scope: Scope): Promise<SQL | undefined> {
  switch (node.type) {
    case "EmptyExpression": return undefined;
    case "ParenthesizedExpression": return compile(db, node.expression, scope);
    case "UnaryOperator": {
      const inner = await compile(db, node.operand, scope);
      // A missing value (no due date) makes a condition NULL: count it as false, so NOT makes it true.
      return inner ? sql`NOT coalesce((${inner}), 0)` : undefined;
    }
    case "LogicalExpression": {
      const [l, r] = await Promise.all([compile(db, node.left, scope), compile(db, node.right, scope)]);
      return node.operator.operator === "OR" ? (l && r ? or(l, r) : undefined) : and(l, r);
    }
    case "Tag": return tagCondition(db, node, scope);
  }
}

// ---- Parsing

export interface ParsedSearch {
  ast: ParserAst;
  sort: SearchSort | null;
  group: SearchGroup | null;
  /** The source ranges of the lifted terms, with an AND beside them, for `splitQuery`. */
  cuts: [number, number][];
}

const isAnd = (node: ParserAst) => node.type === "LogicalExpression" && node.operator.operator === "AND";
const fieldName = (node: ParserAst) => (node.type === "Tag" && node.field.type === "Field" ? node.field.name.toLowerCase() : null);

/** Parses a query and lifts `sort:` and `group:` out of its top level (the terms joined by AND). */
export function parseSearch(q: string): ParsedSearch {
  let ast: ParserAst;
  try {
    ast = parse(q);
  } catch (e) {
    if (e instanceof LiqeSyntaxError) {
      const ch = q[e.offset];
      const hint = ch === "&" || ch === "|" ? `: use AND or OR rather than ${ch}` : "";
      throw invalid(`Can't read the query here${hint}`, e.column);
    }
    throw invalid("The query isn't finished: is a bracket or quote left open?", q.length + 1);
  }
  let sort: SearchSort | null = null;
  let group: SearchGroup | null = null;
  const cuts: [number, number][] = [];
  const lift = (node: ParserAst): ParserAst | null => {
    if (isAnd(node) && node.type === "LogicalExpression") {
      const left = lift(node.left);
      const right = lift(node.right);
      // A written AND goes with the term taken out beside it.
      const op = "location" in node.operator ? (node.operator.location as { start: number; end: number }) : null;
      if (op && (!left || !right)) cuts.push([op.start, op.end]);
      return left && right ? { ...node, left, right } : (left ?? right);
    }
    const name = fieldName(node);
    if (node.type === "Tag" && (name === "sort" || name === "group")) {
      const { value } = literal(node, name);
      if (name === "sort") {
        sort = parseSort(value);
        if (!sort) throw invalid(`sort: is list, priority, due, start, created, updated or title, optionally with -desc (due-desc), not "${value}"`, columnOf(node));
      } else {
        group = parseGroup(value);
        if (!group) throw invalid(`group: is list, due, label, status, none, or "label:wip,next", not "${value}"`, columnOf(node));
      }
      cuts.push([node.location.start, node.location.end]);
      return null;
    }
    return node;
  };
  const rest = lift(ast);
  return { ast: rest ?? { type: "EmptyExpression", location: { start: 0, end: 0 } }, sort, group, cuts };
}

/**
 * A query split into its filter and the sort: and group: at its top level, as a saved filter stores them:
 * `#next AND sort:due` is `#next` sorted by due. Throws a 422 if it doesn't parse.
 */
export function splitQuery(q: string): { query: string; sort: string | null; group: string | null } {
  const { sort, group, cuts } = parseSearch(q);
  let query = q;
  for (const [start, end] of [...cuts].sort((a, b) => b[0] - a[0])) query = query.slice(0, start) + " " + query.slice(end);
  return { query: query.replace(/\s+/g, " ").trim(), sort: sort && formatSort(sort), group: group && formatGroup(group) };
}

/** Whether any term names `field` (optionally with one of `values`). */
function mentions(node: ParserAst, field: string, values?: string[]): boolean {
  switch (node.type) {
    case "ParenthesizedExpression": return mentions(node.expression, field, values);
    case "UnaryOperator": return mentions(node.operand, field, values);
    case "LogicalExpression": return mentions(node.left, field, values) || mentions(node.right, field, values);
    case "Tag": {
      if (fieldName(node) !== field) return false;
      if (!values) return true;
      const e = node.expression;
      return e.type === "LiteralExpression" && values.includes(String(e.value).toLowerCase());
    }
    default: return false;
  }
}

// ---- Running

const PRIORITY_ORDER = sql`CASE ${tasks.priority} WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`;

/**
 * The SQL order for a sort: its key (missing values last), then priority, list and position. A due time sorts by its
 * UTC timestamp among due dates, which is close but not exact near midnight; the web app orders each group exactly.
 */
function orderFor(sort: SearchSort): SQL[] {
  const dir = (s: SQL) => (sort.desc ? desc(s) : asc(s));
  const keyed = (key: SQL) => [sql`(${key}) IS NULL`, dir(key)];
  const tail = [asc(tasks.listId), asc(tasks.position)];
  switch (sort.by) {
    case "list":
    case "priority": return [dir(PRIORITY_ORDER), ...tail];
    case "due": return [...keyed(sql`coalesce(${tasks.dueDate}, ${tasks.dueAt})`), PRIORITY_ORDER, ...tail];
    case "start": return [...keyed(sql`${tasks.startDate}`), PRIORITY_ORDER, ...tail];
    case "created": return [dir(sql`${tasks.createdAt}`), ...tail];
    case "updated": return [dir(sql`${tasks.updatedAt}`), ...tail];
    case "title": return [dir(sql`lower(${tasks.title})`), ...tail];
  }
}

/** What a query needs to know about now: the day, the time zone, the Inbox and the names of folders and lists. */
export async function searchScope(db: Db, at = new Date()): Promise<Scope> {
  const timeZone = await userTimeZone(db);
  const [folderRows, listRows] = await Promise.all([
    db.select({ id: folders.id, name: folders.name, parentId: folders.parentId }).from(folders).where(isNull(folders.deletedAt)),
    db.select({ id: lists.id, name: lists.name, folderId: lists.folderId, inbox: lists.inbox }).from(lists).where(isNull(lists.deletedAt)),
  ]);
  return {
    today: todayIn(timeZone, at),
    timeZone,
    now: at.toISOString(),
    inboxId: listRows.find((l) => l.inbox)?.id ?? null,
    names: { folders: folderRows, lists: listRows },
  };
}

/** Checks a query as running it would (its fields, values and dates), throwing the 422 it would give. */
export async function checkSearch(db: Db, q: string): Promise<void> {
  await compile(db, parseSearch(q).ast, await searchScope(db));
}

/**
 * The condition for a parsed query's tasks, with the defaults (open, unsnoozed, no headings, the context's lists)
 * unless the query or `status` says otherwise. Live tasks only, so it can be counted as it is.
 */
export async function searchCondition(
  db: Db,
  ast: ParserAst,
  run: { context: ContextFilter; status?: "open" | "completed" | "all" },
  scope: Scope,
): Promise<SQL | undefined> {
  const status = run.status ?? (mentions(ast, "is", ["open", "completed"]) || mentions(ast, "completed") ? "all" : "open");
  const contextLists =
    run.context === "all" || mentions(ast, "context") || mentions(ast, "folder") ? null : await listsInContext(db, run.context, scope.inboxId);
  return and(
    isNull(tasks.deletedAt),
    await compile(db, ast, scope),
    status === "open" ? isNull(tasks.completedAt) : status === "completed" ? isNotNull(tasks.completedAt) : undefined,
    mentions(ast, "is", ["heading"]) ? undefined : eq(tasks.kind, "task"),
    mentions(ast, "is", ["snoozed"]) || mentions(ast, "snoozed") ? undefined : notSnoozed(scope.now),
    contextLists ? inListIds(contextLists) : undefined,
  );
}

/** Tasks matching a query, with the sort and grouping in effect (parameters win over `sort:` and `group:` in it). */
export async function searchTasks(db: Db, input: SearchInput) {
  const parsed = parseSearch(input.q);
  const sort = (input.sort ? parseSort(input.sort) : null) ?? parsed.sort ?? DEFAULT_SORT;
  const group = (input.group ? parseGroup(input.group) : null) ?? parsed.group ?? DEFAULT_GROUP;
  const where = await searchCondition(db, parsed.ast, input, await searchScope(db));
  const found = await fetchTasks(db, where, input, orderFor(sort));
  return { tasks: found, sort, group };
}
