import { createRoute, z } from "@hono/zod-openapi";
import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  IdParam,
  TaskCreateSchema,
  TaskMoveSchema,
  TaskQuerySchema,
  TaskSchema,
  TaskUpdateSchema,
} from "@claudia/shared";
import { labels, lists, taskLabels, tasks } from "../db/schema";
import { runBatch, type Db } from "../lib/db";
import { ApiError, notFound } from "../lib/errors";
import { eventQuery } from "../lib/events";
import { newId, now } from "../lib/ids";
import { chunk, resolveLabelIds } from "../lib/labels";
import { positionFor } from "../lib/position";
import { addDays, daysBetween, isValidRule, nextDueDate, todayIn, userTimeZone } from "../lib/recurrence";
import {
  commonErrors,
  jsonBody,
  jsonResponse,
  newRouter,
  notFoundError,
  type Actor,
} from "../lib/router";

const tag = ["Tasks"];
type Row = typeof tasks.$inferSelect;

const live = isNull(tasks.deletedAt);
const inScope = (listId: string, parentId: string | null) =>
  and(eq(tasks.listId, listId), parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId));

const toTask = (r: Row, labelNames: string[]) => ({
  id: r.id,
  listId: r.listId,
  parentId: r.parentId,
  kind: r.kind,
  position: r.position,
  title: r.title,
  notes: r.notes,
  dueDate: r.dueDate,
  dueAt: r.dueAt,
  startDate: r.startDate,
  snoozedUntil: r.snoozedUntil,
  recurRule: r.recurRule,
  recurFrom: r.recurFrom,
  completedAt: r.completedAt,
  labels: labelNames,
  metadata: r.metadata ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function labelNamesFor(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const byTask = new Map<string, string[]>();
  for (const part of chunk(ids)) {
    const rows = await db
      .select({ taskId: taskLabels.taskId, name: labels.name })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, part))
      .orderBy(asc(labels.name));
    for (const r of rows) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r.name]);
  }
  return byTask;
}

async function present(db: Db, rows: Row[]) {
  const names = await labelNamesFor(db, rows.map((r) => r.id));
  return rows.map((r) => toTask(r, names.get(r.id) ?? []));
}

async function getTask(db: Db, id: string): Promise<Row> {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, id), live));
  if (!row) throw notFound("Task");
  return row;
}

const respond = async (db: Db, row: Row) => (await present(db, [row]))[0]!;

async function assertList(db: Db, id: string) {
  const [row] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.id, id), isNull(lists.deletedAt)));
  if (!row) throw notFound("List");
}

/** A task and everything nested under it. */
async function subtreeIds(db: Db, id: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE s(id) AS (
      SELECT ${id}
      UNION ALL
      SELECT t.id FROM tasks t JOIN s ON t.parent_id = s.id WHERE t.deleted_at IS NULL
    ) SELECT id FROM s`);
  return rows.map((r) => r.id);
}

/** Validate where a task will sit: a parent must be a plain task in the same list. */
async function checkParent(db: Db, task: { id?: string; kind: Row["kind"] }, listId: string, parentId: string | null) {
  if (!parentId) return;
  if (task.kind === "heading") throw new ApiError(422, "invalid_parent", "A heading can't be nested under a task");
  const parent = await getTask(db, parentId);
  if (parent.kind === "heading") throw new ApiError(422, "invalid_parent", "Tasks can't be nested under a heading");
  if (parent.listId !== listId) throw new ApiError(422, "invalid_parent", "The parent must be in the same list");
  if (task.id && (await subtreeIds(db, task.id)).includes(parentId)) {
    throw new ApiError(422, "invalid_parent", "A task can't be moved inside itself");
  }
}

/** `checkRule` is false for patches that leave the rule alone, so an old stored rule never blocks unrelated edits. */
function checkRecurrence(r: { recurRule: string | null; recurFrom: string | null }, checkRule = true) {
  if ((r.recurRule === null) !== (r.recurFrom === null)) {
    throw new ApiError(422, "invalid_recurrence", "recurRule and recurFrom must be set together");
  }
  if (checkRule && r.recurRule !== null && !isValidRule(r.recurRule)) {
    throw new ApiError(422, "invalid_recurrence", "recurRule must be a daily or longer RRULE such as FREQ=WEEKLY;BYDAY=MO");
  }
}

const setLabels = (db: Db, taskId: string, ids: string[]): BatchItem<"sqlite">[] => [
  db.delete(taskLabels).where(eq(taskLabels.taskId, taskId)),
  ...(ids.length ? [db.insert(taskLabels).values(ids.map((labelId) => ({ taskId, labelId })))] : []),
];

const snapshot = (r: Row, names: string[]) => toTask(r, names);

/** Tasks matching a query, in list order. Shared by `GET /api/tasks` and saved filters. */
export async function findTasks(db: Db, q: z.infer<typeof TaskQuerySchema>) {
  const where = and(
    live,
    q.listId ? eq(tasks.listId, q.listId) : undefined,
    q.parentId ? eq(tasks.parentId, q.parentId) : undefined,
    q.status === "open" ? isNull(tasks.completedAt) : q.status === "completed" ? isNotNull(tasks.completedAt) : undefined,
    q.dueBefore ? lte(tasks.dueDate, q.dueBefore) : undefined,
    q.dueAfter ? gte(tasks.dueDate, q.dueAfter) : undefined,
    q.q ? sql`(instr(lower(${tasks.title}), lower(${q.q})) > 0 OR instr(lower(coalesce(${tasks.notes}, '')), lower(${q.q})) > 0)` : undefined,
    q.label
      ? sql`EXISTS (SELECT 1 FROM ${taskLabels} tl JOIN ${labels} l ON l.id = tl.label_id WHERE tl.task_id = ${tasks.id} AND lower(l.name) = lower(${q.label}))`
      : undefined,
  );
  const rows = await db.select().from(tasks).where(where).orderBy(asc(tasks.listId), asc(tasks.position)).limit(q.limit).offset(q.offset);
  return present(db, rows);
}

export const taskRoutes = newRouter()
  .openapi(
    createRoute({
      method: "get",
      path: "/api/tasks",
      tags: tag,
      summary: "Query tasks",
      description: "Open tasks by default, in list order. Combine filters to build smart lists.",
      request: { query: TaskQuerySchema },
      responses: { 200: jsonResponse(z.array(TaskSchema), "Tasks"), ...commonErrors },
    }),
    async (c) => {
      return c.json(await findTasks(c.var.db, c.req.valid("query")), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks",
      tags: tag,
      summary: "Create a task or heading",
      request: { body: jsonBody(TaskCreateSchema) },
      responses: { 201: jsonResponse(TaskSchema, "Created"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor: Actor = c.var.actor;
      const kind = input.kind ?? "task";
      const parentId = input.parentId ?? null;
      await assertList(db, input.listId);
      await checkParent(db, { kind }, input.listId, parentId);

      const at = now();
      const row: Row = {
        id: newId(),
        listId: input.listId,
        parentId,
        kind,
        position: await positionFor(db, tasks, and(live, inScope(input.listId, parentId)), input),
        title: input.title,
        notes: input.notes ?? null,
        dueDate: input.dueDate ?? null,
        dueAt: input.dueAt ?? null,
        startDate: input.startDate ?? null,
        snoozedUntil: input.snoozedUntil ?? null,
        recurRule: input.recurRule ?? null,
        recurFrom: input.recurFrom ?? null,
        completedAt: null,
        metadata: input.metadata ?? null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      checkRecurrence(row);

      const { ids, names, pending } = await resolveLabelIds(db, input.labels ?? [], actor);
      await runBatch(db, [
        ...pending,
        db.insert(tasks).values(row),
        ...(ids.length ? [db.insert(taskLabels).values(ids.map((labelId) => ({ taskId: row.id, labelId })))] : []),
        eventQuery(db, { entityType: "task", entityId: row.id, type: "created", after: snapshot(row, names), actor }),
      ]);
      return c.json(toTask(row, names), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Get a task",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskSchema, "Task"), ...commonErrors, ...notFoundError },
    }),
    async (c) => c.json(await respond(c.var.db, await getTask(c.var.db, c.req.valid("param").id)), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Update a task's fields or labels",
      description: "Only the fields you send change. Send null to clear a nullable field.",
      request: { params: IdParam, body: jsonBody(TaskUpdateSchema) },
      responses: { 200: jsonResponse(TaskSchema, "Updated"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { labels: newLabels, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const actor: Actor = c.var.actor;
      const before = await getTask(db, id);
      const beforeNames = (await labelNamesFor(db, [id])).get(id) ?? [];

      const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const after: Row = { ...before, ...defined, updatedAt: now() };
      checkRecurrence(after, defined.recurRule !== undefined);

      const statements: BatchItem<"sqlite">[] = [];
      let afterNames = beforeNames;
      if (newLabels) {
        const { ids, names, pending } = await resolveLabelIds(db, newLabels, actor);
        statements.push(...pending, ...setLabels(db, id, ids));
        afterNames = names;
      }
      await runBatch(db, [
        ...statements,
        db.update(tasks).set({ ...defined, updatedAt: after.updatedAt }).where(eq(tasks.id, id)),
        eventQuery(db, { entityType: "task", entityId: id, type: "updated", before: snapshot(before, beforeNames), after: snapshot(after, afterNames), actor }),
      ]);
      return c.json(toTask(after, afterNames), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/move",
      tags: tag,
      summary: "Move a task to another list or parent, and/or reorder it",
      description: "Nested tasks move with their parent. Omit listId and parentId to reorder in place.",
      request: { params: IdParam, body: jsonBody(TaskMoveSchema) },
      responses: { 200: jsonResponse(TaskSchema, "Moved"), ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor: Actor = c.var.actor;
      const before = await getTask(db, id);

      const listId = input.listId ?? before.listId;
      // Changing list without naming a parent puts the task at the top level of the new list.
      const parentId = input.parentId !== undefined ? input.parentId : listId === before.listId ? before.parentId : null;
      if (listId !== before.listId) await assertList(db, listId);
      await checkParent(db, before, listId, parentId);

      const after: Row = {
        ...before,
        listId,
        parentId,
        position: await positionFor(db, tasks, and(live, inScope(listId, parentId)), input),
        updatedAt: now(),
      };
      const names = (await labelNamesFor(db, [id])).get(id) ?? [];
      const statements: BatchItem<"sqlite">[] = [
        db.update(tasks).set({ listId, parentId, position: after.position, updatedAt: after.updatedAt }).where(eq(tasks.id, id)),
        eventQuery(db, { entityType: "task", entityId: id, type: "moved", before: snapshot(before, names), after: snapshot(after, names), actor }),
      ];
      if (listId !== before.listId) {
        for (const childId of (await subtreeIds(db, id)).filter((x) => x !== id)) {
          statements.push(
            db.update(tasks).set({ listId, updatedAt: after.updatedAt }).where(eq(tasks.id, childId)),
            eventQuery(db, { entityType: "task", entityId: childId, type: "moved", before: { listId: before.listId }, after: { listId }, actor }),
          );
        }
      }
      await runBatch(db, statements);
      return c.json(toTask(after, names), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/complete",
      tags: tag,
      summary: "Complete a task",
      description:
        "Completing a task that repeats advances it to its next due date and keeps it open; completing it twice advances it twice. Other tasks: idempotent.",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskSchema, "Completed"), ...commonErrors, ...notFoundError },
    }),
    (c) => setCompleted(c.var.db, c.var.actor, c.req.valid("param").id, true).then((t) => c.json(t, 200)),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/uncomplete",
      tags: tag,
      summary: "Reopen a completed task",
      request: { params: IdParam },
      responses: { 200: jsonResponse(TaskSchema, "Reopened"), ...commonErrors, ...notFoundError },
    }),
    (c) => setCompleted(c.var.db, c.var.actor, c.req.valid("param").id, false).then((t) => c.json(t, 200)),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/api/tasks/{id}",
      tags: tag,
      summary: "Delete a task and anything nested under it (soft)",
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, ...commonErrors, ...notFoundError },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const actor: Actor = c.var.actor;
      const root = await getTask(db, id);
      const at = now();
      const statements: BatchItem<"sqlite">[] = [];
      for (const taskId of await subtreeIds(db, id)) {
        statements.push(
          db.update(tasks).set({ deletedAt: at, updatedAt: at }).where(eq(tasks.id, taskId)),
          eventQuery(db, {
            entityType: "task",
            entityId: taskId,
            type: "deleted",
            before: taskId === id ? snapshot(root, (await labelNamesFor(db, [id])).get(id) ?? []) : { via: id },
            actor,
          }),
        );
      }
      await runBatch(db, statements);
      return c.body(null, 204);
    },
  );

async function setCompleted(db: Db, actor: Actor, id: string, done: boolean) {
  const before = await getTask(db, id);
  if (Boolean(before.completedAt) === done) return respond(db, before);
  const at = now();
  const names = (await labelNamesFor(db, [id])).get(id) ?? [];

  // A repeating task moves to its next due date and stays open (tasks with a due time aren't advanced yet).
  if (done && before.kind === "task" && before.recurRule && before.recurFrom && !before.dueAt && isValidRule(before.recurRule)) {
    const next = nextDueDate(before.recurRule, before.recurFrom, before.dueDate, todayIn(await userTimeZone(db)));
    if (next) {
      const startDate = before.startDate && before.dueDate ? addDays(before.startDate, daysBetween(before.dueDate, next)) : before.startDate;
      const advanced: Row = { ...before, dueDate: next, startDate, snoozedUntil: null, updatedAt: at };
      const dates = (r: Row) => ({ dueDate: r.dueDate, startDate: r.startDate, snoozedUntil: r.snoozedUntil });
      await runBatch(db, [
        db.update(tasks).set({ ...dates(advanced), updatedAt: at }).where(eq(tasks.id, id)),
        eventQuery(db, { entityType: "task", entityId: id, type: "completed", before: dates(before), after: dates(advanced), actor }),
      ]);
      return toTask(advanced, names);
    }
  }

  const after: Row = { ...before, completedAt: done ? at : null, updatedAt: at };
  await runBatch(db, [
    db.update(tasks).set({ completedAt: after.completedAt, updatedAt: at }).where(eq(tasks.id, id)),
    eventQuery(db, {
      entityType: "task",
      entityId: id,
      type: done ? "completed" : "uncompleted",
      before: { completedAt: before.completedAt },
      after: { completedAt: after.completedAt },
      actor,
    }),
  ]);
  return toTask(after, names);
}
