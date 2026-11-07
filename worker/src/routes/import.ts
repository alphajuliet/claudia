import { createRoute } from "@hono/zod-openapi";
import type { BatchItem } from "drizzle-orm/batch";
import { generateNKeysBetween } from "fractional-indexing";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { ErrorSchema, ImportResultSchema, ImportSchema, type ImportBatch } from "@claudia/shared";
import { folders, labels, lists, taskLabels, tasks } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { ApiError } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { chunk } from "../lib/labels";
import { commonErrors, jsonBody, jsonResponse, newRouter } from "../lib/router";

type Table = typeof folders | typeof lists | typeof labels | typeof tasks;

async function existingIds(db: Db, table: Table, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids)) {
    const rows = await db.select({ id: table.id }).from(table).where(inArray(table.id, part));
    for (const r of rows) found.add(r.id);
  }
  return found;
}

/** Order items so each comes after its parent; reject cycles. */
function parentsFirst<T extends { id: string; parentId: string | null }>(items: T[]): T[] {
  const ids = new Set(items.map((i) => i.id));
  const done = new Set<string>();
  const out: T[] = [];
  let pending = items;
  while (pending.length) {
    const ready = pending.filter((i) => !i.parentId || !ids.has(i.parentId) || done.has(i.parentId));
    if (!ready.length) throw new ApiError(422, "invalid_parent", "Parent references form a cycle");
    for (const i of ready) {
      done.add(i.id);
      out.push(i);
    }
    pending = pending.filter((i) => !done.has(i.id));
  }
  return out;
}

async function requireExisting(db: Db, table: Table, refs: (string | null)[], inPayload: Set<string>, what: string) {
  const need = [...new Set(refs.filter((r): r is string => !!r && !inPayload.has(r)))];
  if (!need.length) return;
  const have = await existingIds(db, table, need);
  const missing = need.filter((id) => !have.has(id));
  if (missing.length) throw new ApiError(422, "missing_reference", `Unknown ${what}: ${missing.join(", ")}`);
}

/** Sibling scopes, as the unique position indexes see them. */
const scopeKey = (...parts: (string | null)[]) => parts.map((p) => p ?? "").join("|");

/**
 * Imported items keep their positions unless one clashes with a live sibling already here, or with another imported
 * sibling: then that scope's imported items are put after what's here, in their own order. So importing again into
 * a list that has gained tasks since doesn't trip the unique position index.
 */
function fitPositions<T extends { position: string }>(items: T[], scopeOf: (item: T) => string, taken: Map<string, string[]>): T[] {
  const byScope = new Map<string, T[]>();
  for (const item of items) byScope.set(scopeOf(item), [...(byScope.get(scopeOf(item)) ?? []), item]);
  const moved = new Map<T, string>();
  for (const [scope, members] of byScope) {
    const here = new Set(taken.get(scope) ?? []);
    const mine = members.map((m) => m.position);
    if (new Set(mine).size === mine.length && !mine.some((p) => here.has(p))) continue;
    const last = [...here].sort().at(-1) ?? null;
    const ordered = [...members].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    generateNKeysBetween(last, null, ordered.length).forEach((key, i) => moved.set(ordered[i]!, key));
  }
  return items.map((item) => (moved.has(item) ? { ...item, position: moved.get(item)! } : item));
}

/** Live positions in each scope, read by `query` for the scope ids in chunks. */
async function takenPositions(
  ids: string[],
  query: (part: string[]) => Promise<{ scope: string; position: string }[]>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const part of chunk([...new Set(ids)])) {
    for (const r of await query(part)) out.set(r.scope, [...(out.get(r.scope) ?? []), r.position]);
  }
  return out;
}

export async function importBatch(db: Db, input: ImportBatch) {
  const inFolders = new Set(input.folders.map((f) => f.id));
  const inLists = new Set(input.lists.map((l) => l.id));
  const inTasks = new Set(input.tasks.map((t) => t.id));

  // Labels are matched by name: a label that already exists under another id
  // stands in for the imported one.
  const existingLabels = new Map<string, string>(); // lowercase name -> id
  for (const part of chunk(input.labels.map((l) => l.name.toLowerCase()))) {
    const rows = await db.select().from(labels).where(inArray(sql`lower(${labels.name})`, part));
    for (const r of rows) existingLabels.set(r.name.toLowerCase(), r.id);
  }
  const labelRemap = new Map<string, string>();
  const newLabels = input.labels.filter((l) => {
    const existing = existingLabels.get(l.name.toLowerCase());
    if (existing) labelRemap.set(l.id, existing);
    return !existing;
  });
  const inLabels = new Set(input.labels.map((l) => l.id));
  const remapped = (id: string) => labelRemap.get(id) ?? id;

  await requireExisting(db, folders, input.folders.map((f) => f.parentId), inFolders, "parent folder");
  await requireExisting(db, folders, input.lists.map((l) => l.folderId), inFolders, "folder");
  await requireExisting(db, lists, input.tasks.map((t) => t.listId), inLists, "list");
  await requireExisting(db, tasks, input.tasks.map((t) => t.parentId), inTasks, "parent task");
  await requireExisting(db, labels, input.tasks.flatMap((t) => t.labelIds).filter((id) => !inLabels.has(id)), new Set(), "label");

  const [haveFolders, haveLists, haveLabels, haveTasks] = await Promise.all([
    existingIds(db, folders, [...inFolders]),
    existingIds(db, lists, [...inLists]),
    existingIds(db, labels, newLabels.map((l) => l.id)),
    existingIds(db, tasks, [...inTasks]),
  ]);

  const folderScope = (f: { parentId: string | null }) => scopeKey(f.parentId);
  const listScope = (l: { folderId: string | null }) => scopeKey(l.folderId);
  const taskScope = (t: { listId: string; parentId: string | null }) => scopeKey(t.listId, t.parentId);
  const addedFolders = input.folders.filter((f) => !haveFolders.has(f.id));
  const addedLists = input.lists.filter((l) => !haveLists.has(l.id));
  const addedTasks = input.tasks.filter((t) => !haveTasks.has(t.id));
  // Top-level folders and unfiled lists have no parent to look up by, so those scopes are read whole.
  const live = <T extends typeof folders | typeof lists | typeof tasks>(t: T) => isNull(t.deletedAt);
  const [folderSlots, listSlots, taskSlots] = await Promise.all([
    takenPositions(["", ...addedFolders.map((f) => f.parentId ?? "")], (part) =>
      db.select({ scope: sql<string>`coalesce(${folders.parentId}, '')`, position: folders.position }).from(folders)
        .where(and(live(folders), inArray(sql`coalesce(${folders.parentId}, '')`, part)))),
    takenPositions(["", ...addedLists.map((l) => l.folderId ?? "")], (part) =>
      db.select({ scope: sql<string>`coalesce(${lists.folderId}, '')`, position: lists.position }).from(lists)
        .where(and(live(lists), inArray(sql`coalesce(${lists.folderId}, '')`, part)))),
    takenPositions(addedTasks.map((t) => t.listId), (part) =>
      db.select({ scope: sql<string>`${tasks.listId} || '|' || coalesce(${tasks.parentId}, '')`, position: tasks.position }).from(tasks)
        .where(and(live(tasks), inArray(tasks.listId, part)))),
  ]);

  const newFolders = parentsFirst(fitPositions(addedFolders, folderScope, folderSlots));
  const newLists = fitPositions(addedLists, listScope, listSlots);
  const freshLabels = newLabels.filter((l) => !haveLabels.has(l.id));
  const newTasks = parentsFirst(fitPositions(addedTasks, taskScope, taskSlots));

  const log = (entityType: "folder" | "list" | "label" | "task", entityId: string, after: unknown) =>
    eventQuery(db, { entityType, entityId, type: "imported", after, actor: "import" });

  const statements: BatchItem<"sqlite">[] = [];
  for (const f of newFolders) {
    statements.push(db.insert(folders).values({ ...f, deletedAt: null }), log("folder", f.id, f));
  }
  for (const l of newLists) {
    statements.push(db.insert(lists).values({ ...l, deletedAt: null }), log("list", l.id, l));
  }
  for (const l of freshLabels) {
    statements.push(db.insert(labels).values({ ...l, deletedAt: null }), log("label", l.id, l));
  }
  for (const { labelIds, ...t } of newTasks) {
    statements.push(db.insert(tasks).values({ ...t, deletedAt: null }), log("task", t.id, { ...t, labelIds }));
    const unique = [...new Set(labelIds.map(remapped))];
    if (unique.length) {
      statements.push(db.insert(taskLabels).values(unique.map((labelId) => ({ taskId: t.id, labelId }))));
    }
  }
  if (statements.length) await runBatch(db, statements);

  return {
    inserted: { folders: newFolders.length, lists: newLists.length, labels: freshLabels.length, tasks: newTasks.length },
    skipped: {
      folders: input.folders.length - newFolders.length,
      lists: input.lists.length - newLists.length,
      labels: input.labels.length - freshLabels.length,
      tasks: input.tasks.length - newTasks.length,
    },
  };
}

export const importRoutes = newRouter().openapi(
  createRoute({
    method: "post",
    path: "/api/import",
    tags: ["Import"],
    summary: "Bulk-insert data with its original IDs and timestamps",
    description:
      "Admin only. Existing IDs are skipped, so a run can be repeated. Parents must be in the same request or already stored. " +
      "Labels are matched by name, and a label that already exists stands in for the imported one.",
    request: { body: jsonBody(ImportSchema) },
    responses: {
      200: jsonResponse(ImportResultSchema, "What was inserted and skipped"),
      422: jsonResponse(ErrorSchema, "A reference is missing or cyclic"),
      ...commonErrors,
    },
  }),
  async (c) => c.json(await importBatch(c.var.db, c.req.valid("json")), 200),
);
