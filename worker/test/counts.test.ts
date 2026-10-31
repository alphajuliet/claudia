import { beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "../src/lib/recurrence";
import { client, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let inbox: { id: string };
let garden: { id: string };
const today = todayIn("Australia/Sydney");

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]));
  inbox = (await api("POST", "/api/lists", { name: "Inbox" })).body;
  garden = (await api("POST", "/api/lists", { name: "Garden" })).body;
});

const task = async (listId: string, title: string, extra: object = {}) =>
  (await api("POST", "/api/tasks", { listId, title, ...extra })).body;

describe("GET /api/counts", () => {
  it("counts open, unsnoozed tasks per list, with due-today and label counts", async () => {
    await task(inbox.id, "Overdue", { dueDate: addDays(today, -3), labels: ["next"] });
    await task(inbox.id, "Due today", { dueDate: today, labels: ["Next", "wip"] });
    await task(inbox.id, "Later", { dueDate: addDays(today, 5) });
    const parent = await task(inbox.id, "Parent");
    await task(inbox.id, "Subtask", { parentId: parent.id });
    await task(inbox.id, "Section", { kind: "heading" });
    await task(inbox.id, "Snoozed", { snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(), labels: ["next"] });
    await task(inbox.id, "Woken", { snoozedUntil: new Date(Date.now() - 86_400_000).toISOString() });
    const done = await task(inbox.id, "Done", { labels: ["next"] });
    await api("POST", `/api/tasks/${done.id}/complete`);
    const gone = await task(inbox.id, "Gone");
    await api("DELETE", `/api/tasks/${gone.id}`);
    await task(garden.id, "Weed", { labels: ["someday"] });

    const res = await api("GET", "/api/counts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      lists: {
        // Overdue, Due today, Later, Parent, Subtask, Woken.
        [inbox.id]: { open: 6, today: 2, labels: { next: 2, wip: 1 } },
        [garden.id]: { open: 1, today: 0, labels: { someday: 1 } },
      },
    });
  });

  it("counts a due time by its day in the user's time zone, and leaves out lists with nothing open", async () => {
    await task(inbox.id, "Timed", { dueAt: new Date(Date.now() - 60_000).toISOString() });
    await task(inbox.id, "Next week", { dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    const res = await api("GET", "/api/counts");
    expect(res.body.lists[inbox.id]).toEqual({ open: 2, today: 1, labels: {} });
    expect(res.body.lists[garden.id]).toBeUndefined();
  });

  it("is open to read tokens", async () => {
    const read = client(await makeToken(["read"]));
    expect((await read("GET", "/api/counts")).status).toBe(200);
  });
});
