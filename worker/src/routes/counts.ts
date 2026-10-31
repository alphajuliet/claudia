import { createRoute } from "@hono/zod-openapi";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { CountsSchema, type Counts } from "@claudia/shared";
import { labels, taskLabels, tasks } from "../db/schema";
import { addDays, startOfDayIn, todayIn, userTimeZone } from "../lib/recurrence";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

export const countRoutes = newRouter().openapi(
  createRoute({
    method: "get",
    path: "/api/counts",
    tags: ["Tasks"],
    summary: "Open-task counts per list",
    description:
      "For each list: its open, unsnoozed tasks (not headings, subtasks included), how many are due today or earlier, " +
      "and how many carry each label. The web app's sidebar adds these up for the lists in the chosen context.",
    responses: { 200: jsonResponse(CountsSchema, "Counts per list"), ...commonErrors },
  }),
  async (c) => {
    const db = c.var.db;
    const timeZone = await userTimeZone(db);
    const at = new Date().toISOString();
    const tomorrow = startOfDayIn(addDays(todayIn(timeZone), 1), timeZone).toISOString();
    const open = and(
      isNull(tasks.deletedAt),
      isNull(tasks.completedAt),
      eq(tasks.kind, "task"),
      or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, at)),
    );
    const due = or(lte(tasks.dueDate, todayIn(timeZone)), lt(tasks.dueAt, tomorrow));
    const [perList, perLabel] = await Promise.all([
      db
        .select({ listId: tasks.listId, open: sql<number>`count(*)`, today: sql<number>`sum(case when ${due} then 1 else 0 end)` })
        .from(tasks)
        .where(open)
        .groupBy(tasks.listId),
      db
        .select({ listId: tasks.listId, label: sql<string>`lower(${labels.name})`, n: sql<number>`count(*)` })
        .from(tasks)
        .innerJoin(taskLabels, eq(taskLabels.taskId, tasks.id))
        .innerJoin(labels, and(eq(labels.id, taskLabels.labelId), isNull(labels.deletedAt)))
        .where(open)
        .groupBy(tasks.listId, sql`lower(${labels.name})`),
    ]);
    const out: Counts = { lists: {} };
    for (const r of perList) out.lists[r.listId] = { open: Number(r.open), today: Number(r.today ?? 0), labels: {} };
    for (const r of perLabel) {
      const list = out.lists[r.listId];
      if (list) list.labels[r.label] = Number(r.n);
    }
    return c.json(out, 200);
  },
);
