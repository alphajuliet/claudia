import { createRoute } from "@hono/zod-openapi";
import { CaptureSchema, TaskSchema, parseQuickAdd, parseWhen, zonedToUtc } from "@claudia/shared";
import { findInbox } from "./lists";
import { ApiError } from "../lib/errors";
import { userTimeZone } from "../lib/recurrence";
import { commonErrors, jsonBody, jsonResponse, newRouter } from "../lib/router";
import { createTask } from "../domain/tasks";

/**
 * Reads capture text as quick add does: `#labels` come out, then a date or time at the end of what's left
 * ("tomorrow", "fri 3pm") becomes the due date, or due time in the user's time zone.
 */
export function readCapture(text: string, now: Date, timeZone: string) {
  const { title, labels } = parseQuickAdd(text);
  const found = parseWhen(title, now, timeZone);
  if (!found) return { title, labels };
  const { date, time } = found.when;
  return { title: found.title, labels, ...(time ? { dueAt: zonedToUtc(date, time, timeZone) } : { dueDate: date }) };
}

export const captureRoutes = newRouter().openapi(
  createRoute({
    method: "post",
    path: "/api/capture",
    tags: ["Tasks"],
    summary: "Capture a task into the Inbox",
    description:
      "Adds a task to the Inbox (the list flagged `inbox`, whatever it is called) from one line of text, read as the web app's quick add reads it: #labels become labels (missing ones are created) and a date or time at the end, such as \"tomorrow\" or \"fri 3pm\", becomes the due date. For the iOS Shortcut and other quick clients.",
    request: { body: jsonBody(CaptureSchema) },
    responses: { 201: jsonResponse(TaskSchema, "Captured"), ...commonErrors },
  }),
  async (c) => {
    const { text, notes } = c.req.valid("json");
    const db = c.var.db;
    const inbox = await findInbox(db);
    if (!inbox) throw new ApiError(422, "no_inbox", "There's no Inbox to capture into: make a list the Inbox first");
    const read = readCapture(text, new Date(), await userTimeZone(db));
    return c.json(await createTask(db, c.var.actor, { listId: inbox.id, notes: notes ?? null, ...read }), 201);
  },
);
