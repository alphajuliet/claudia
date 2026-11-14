import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { folders } from "../src/db/schema";
import { addDays, todayIn } from "../src/lib/recurrence";
import { client, db, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
const today = todayIn("Australia/Sydney");
let inbox: { id: string };
let loose: { id: string };
let job: { id: string };
let garden: { id: string };
let hidden: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]));
  await api("PUT", "/api/settings/timeZone", { value: "Australia/Sydney" });
  const work = (await api("POST", "/api/folders", { name: "Acme", context: "work" })).body;
  const home = (await api("POST", "/api/folders", { name: "House", context: "home" })).body;
  // A personal folder inside a work one: hidden in Work, and in Personal too (its parent isn't shown). The API now
  // gives a subfolder its parent's context, so this is older data, written straight to the table.
  const odd = (await api("POST", "/api/folders", { name: "Odd", parentId: work.id })).body;
  await db.update(folders).set({ context: "personal" }).where(eq(folders.id, odd.id));
  inbox = (await api("POST", "/api/lists", { name: "📥 Capture", inbox: true })).body;
  loose = (await api("POST", "/api/lists", { name: "Errands" })).body;
  job = (await api("POST", "/api/lists", { name: "Projects", folderId: work.id })).body;
  garden = (await api("POST", "/api/lists", { name: "Garden", folderId: home.id })).body;
  hidden = (await api("POST", "/api/lists", { name: "Odd list", folderId: odd.id })).body;
});

const add = async (listId: string, title: string, extra: object = {}) => (await api("POST", "/api/tasks", { listId, title, ...extra })).body;
const view = async (id: string, qs = "") => {
  const res = await api("GET", `/api/views/${id}/tasks${qs}`);
  return res.status === 200 ? (res.body as { title: string }[]).map((t) => t.title).sort() : res;
};

describe("views", () => {
  it("shows open, unsnoozed tasks, not headings, and Inbox by its flag", async () => {
    await add(inbox.id, "Sort the post");
    await add(inbox.id, "Section", { kind: "heading" });
    await add(inbox.id, "Later", { snoozedUntil: "2999-01-01T00:00:00.000Z" });
    await add(inbox.id, "Woke up", { snoozedUntil: "2000-01-01T00:00:00.000Z" });
    const done = await add(inbox.id, "Done");
    await api("POST", `/api/tasks/${done.id}/complete`);
    await add(loose.id, "Elsewhere");
    expect(await view("inbox")).toEqual(["Sort the post", "Woke up"]);
  });

  it("shows in Today what's due or started today or earlier, a due time by its day", async () => {
    await add(loose.id, "Overdue", { dueDate: addDays(today, -2) });
    await add(loose.id, "Due today", { dueDate: today });
    await add(loose.id, "Started", { startDate: today, dueDate: addDays(today, 5) });
    await add(loose.id, "Tomorrow", { dueDate: addDays(today, 1) });
    await add(loose.id, "Starts tomorrow", { startDate: addDays(today, 1) });
    await add(loose.id, "Nothing");
    expect(await view("today")).toEqual(["Due today", "Overdue", "Started"]);
  });

  it("shows a label's tasks in its view, in any case", async () => {
    await add(loose.id, "Call Sam", { labels: ["Next"] });
    await add(loose.id, "Chase invoice", { labels: ["waitingon"] });
    await add(loose.id, "Learn Welsh", { labels: ["someday"] });
    await add(loose.id, "Draft", { labels: ["wip"] });
    expect(await view("next")).toEqual(["Call Sam"]);
    expect(await view("waiting")).toEqual(["Chase invoice"]);
    expect(await view("someday")).toEqual(["Learn Welsh"]);
    expect(await view("wip")).toEqual(["Draft"]);
  });

  it("narrows to a context's lists: its folders, lists in no folder and the Inbox, not archived lists", async () => {
    for (const [l, name] of [[inbox, "In inbox"], [loose, "Loose"], [job, "At work"], [garden, "At home"], [hidden, "Hidden"]] as const) {
      await add(l.id, name, { labels: ["next"] });
    }
    expect(await view("next", "?context=work")).toEqual(["At work", "In inbox", "Loose"]);
    expect(await view("next", "?context=home")).toEqual(["At home", "In inbox", "Loose"]);
    expect(await view("next", "?context=personal")).toEqual(["In inbox", "Loose"]);
    expect(await view("next")).toEqual(["At home", "At work", "Hidden", "In inbox", "Loose"]);
    await api("PATCH", `/api/lists/${loose.id}`, { archived: true });
    expect(await view("next", "?context=work")).toEqual(["At work", "In inbox"]);
  });

  it("gives completed tasks with status=completed, and for Today only those completed today", async () => {
    const a = await add(loose.id, "Old one", { dueDate: addDays(today, -1), labels: ["next"] });
    await api("POST", `/api/tasks/${a.id}/complete`);
    await add(loose.id, "Still open", { dueDate: today, labels: ["next"] });
    expect(await view("next", "?status=completed")).toEqual(["Old one"]);
    expect(await view("today", "?status=completed")).toEqual(["Old one"]);
  });

  it("counts what each view shows, in the context", async () => {
    await add(inbox.id, "Sort the post");
    await add(job.id, "Report", { labels: ["wip"], dueDate: today });
    await add(garden.id, "Mow", { labels: ["wip"] });
    const counts = async (qs = "") => Object.fromEntries(((await api("GET", `/api/views${qs}`)).body as { id: string; count: number }[]).map((v) => [v.id, v.count]));
    expect(await counts()).toEqual({ inbox: 1, today: 1, next: 0, wip: 2, waiting: 0, someday: 0 });
    expect(await counts("?context=home")).toEqual({ inbox: 1, today: 0, next: 0, wip: 1, waiting: 0, someday: 0 });
    const [summary] = (await api("GET", "/api/views")).body;
    expect(summary).toEqual({ id: "inbox", name: "Inbox", label: null, count: 1 });
  });

  it("says when there's no Inbox, and refuses an unknown view", async () => {
    await reset();
    api = client(await makeToken(["read"]));
    expect(await view("inbox")).toMatchObject({ status: 422, body: { error: { code: "no_inbox" } } });
    expect((await api("GET", "/api/views")).body[0]).toMatchObject({ id: "inbox", count: 0 });
    expect((await api("GET", "/api/views/nope/tasks")).status).toBe(400);
  });
});
