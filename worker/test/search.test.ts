import { beforeEach, describe, expect, it } from "vitest";
import { resolveDate, splitQuery } from "../src/domain/search";
import { addDays, startOfDayIn, todayIn } from "../src/lib/recurrence";
import { client, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
const today = todayIn("Australia/Sydney");
let inbox: { id: string };
let errands: { id: string };
let projects: { id: string };
let deep: { id: string };
let garden: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]));
  await api("PUT", "/api/settings/timeZone", { value: "Australia/Sydney" });
  const work = (await api("POST", "/api/folders", { name: "💼 Work", context: "work" })).body;
  const clients = (await api("POST", "/api/folders", { name: "Clients", parentId: work.id })).body;
  const home = (await api("POST", "/api/folders", { name: "House", context: "home" })).body;
  inbox = (await api("POST", "/api/lists", { name: "📥 Inbox", inbox: true })).body;
  errands = (await api("POST", "/api/lists", { name: "Errands" })).body;
  projects = (await api("POST", "/api/lists", { name: "🛠️ Projects", folderId: work.id })).body;
  deep = (await api("POST", "/api/lists", { name: "Acme bid", folderId: clients.id })).body;
  garden = (await api("POST", "/api/lists", { name: "Garden", folderId: home.id })).body;
});

const add = async (listId: string, title: string, extra: object = {}) => (await api("POST", "/api/tasks", { listId, title, ...extra })).body;

const search = async (q: string, params: Record<string, string> = {}) => {
  const res = await api("GET", `/api/search?${new URLSearchParams({ q, ...params })}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { tasks: { title: string }[]; sort: unknown; group: unknown };
};
const titles = async (q: string, params: Record<string, string> = {}) => (await search(q, params)).tasks.map((t) => t.title).sort();
const failure = async (q: string) => {
  const res = await api("GET", `/api/search?${new URLSearchParams({ q })}`);
  expect(res.status).toBe(422);
  return res.body.error as { code: string; message: string; issues: { column: number }[] };
};

describe("resolveDate", () => {
  it("reads words, offsets and ISO dates", () => {
    expect(resolveDate("today", "2026-11-16")).toBe("2026-11-16");
    expect(resolveDate("Tomorrow", "2026-11-16")).toBe("2026-11-17");
    expect(resolveDate("yesterday", "2026-11-16")).toBe("2026-11-15");
    expect(resolveDate("7d", "2026-11-16")).toBe("2026-11-23");
    expect(resolveDate("2w", "2026-11-16")).toBe("2026-11-30");
    expect(resolveDate("3m", "2026-11-30")).toBe("2027-02-28");
    expect(resolveDate("today-7d", "2026-11-16")).toBe("2026-11-09");
    expect(resolveDate("tomorrow+1w", "2026-11-16")).toBe("2026-11-24");
    expect(resolveDate("2026-12-25", "2026-11-16")).toBe("2026-12-25");
  });

  it("rejects anything else", () => {
    for (const w of ["soon", "-7d", "+7d", "7y", "2026-13-40", "2026-1-1"]) expect(resolveDate(w, "2026-11-16")).toBeNull();
  });
});

describe("splitQuery", () => {
  it("takes top-level sort: and group: out of the text, with an AND beside them", () => {
    expect(splitQuery("#next AND sort:due")).toEqual({ query: "#next", sort: "due", group: null });
    expect(splitQuery("group:\"label:wip,next\" #next   due:<=today sort:title-desc")).toEqual({
      query: "#next due:<=today", sort: "title-desc", group: "label:wip,next",
    });
    expect(splitQuery("sort:due AND group:none AND (#a OR #b)")).toEqual({ query: "(#a OR #b)", sort: "due", group: "none" });
    expect(splitQuery("#a")).toEqual({ query: "#a", sort: null, group: null });
    expect(splitQuery("sort:due")).toEqual({ query: "", sort: "due", group: null });
    // Not at the top level, it stays (and running or saving it is an error).
    expect(splitQuery("(#a OR sort:due)")).toEqual({ query: "(#a OR sort:due)", sort: null, group: null });
  });
});

describe("search", () => {
  it("matches words and phrases in title or notes, ignoring case", async () => {
    await add(errands.id, "Weekly report");
    await add(errands.id, "Call Sam", { notes: "about the REPORT" });
    await add(errands.id, "Report weekly");
    await add(errands.id, "Other");
    expect(await titles("report")).toEqual(["Call Sam", "Report weekly", "Weekly report"]);
    expect(await titles('"weekly report"')).toEqual(["Weekly report"]);
    expect(await titles("weekly report")).toEqual(["Report weekly", "Weekly report"]);
  });

  it("matches labels by #name or label:, ignoring case, with wildcards", async () => {
    await add(errands.id, "A", { labels: ["next"] });
    await add(errands.id, "B", { labels: ["waitingOn"] });
    await add(errands.id, "C", { labels: ["wip", "next"] });
    await add(errands.id, "D");
    expect(await titles("#next")).toEqual(["A", "C"]);
    expect(await titles("label:NEXT")).toEqual(["A", "C"]);
    expect(await titles("label:wait*")).toEqual(["B"]);
    expect(await titles("-#next")).toEqual(["B", "D"]);
  });

  it("combines with AND, OR, NOT and brackets, a space meaning AND", async () => {
    await add(errands.id, "A", { labels: ["next"], priority: "high" });
    await add(errands.id, "B", { labels: ["wip"] });
    await add(errands.id, "C", { labels: ["next"] });
    await add(errands.id, "D");
    expect(await titles("#next priority:high")).toEqual(["A"]);
    expect(await titles("#next AND priority:high")).toEqual(["A"]);
    expect(await titles("#wip OR priority:high")).toEqual(["A", "B"]);
    expect(await titles("(#wip OR #next) NOT priority:high")).toEqual(["B", "C"]);
    expect(await titles("NOT (#wip OR #next)")).toEqual(["D"]);
  });

  it("finds lists by name ignoring a leading emoji, and folders with their subfolders", async () => {
    await add(projects.id, "In projects");
    await add(deep.id, "In a subfolder");
    await add(garden.id, "In the garden");
    await add(errands.id, "Loose");
    expect(await titles("list:projects")).toEqual(["In projects"]);
    expect(await titles('list:"🛠️ Projects"')).toEqual(["In projects"]);
    expect(await titles("list:proj*")).toEqual(["In projects"]);
    expect(await titles("folder:work")).toEqual(["In a subfolder", "In projects"]);
    expect(await titles("folder:clients")).toEqual(["In a subfolder"]);
    expect(await titles("list:nowhere")).toEqual([]);
  });

  it("narrows to the sidebar context unless the query names context: or folder:", async () => {
    await add(projects.id, "Work task");
    await add(garden.id, "Home task");
    await add(errands.id, "Loose task");
    await add(inbox.id, "Inbox task");
    expect(await titles("task", { context: "home" })).toEqual(["Home task", "Inbox task", "Loose task"]);
    expect(await titles("task context:work", { context: "home" })).toEqual(["Inbox task", "Loose task", "Work task"]);
    expect(await titles("task folder:work", { context: "home" })).toEqual(["Work task"]);
    expect(await titles("task")).toHaveLength(4);
  });

  it("compares priority as low < normal < high", async () => {
    await add(errands.id, "Low", { priority: "low" });
    await add(errands.id, "Normal");
    await add(errands.id, "High", { priority: "high" });
    expect(await titles("priority:>=normal")).toEqual(["High", "Normal"]);
    expect(await titles("priority:<normal")).toEqual(["Low"]);
  });

  it("compares dates, a due time by its day in the time zone", async () => {
    await add(errands.id, "Overdue", { dueDate: addDays(today, -2) });
    await add(errands.id, "Today", { dueDate: today });
    // Early tomorrow in Sydney, which can still be today in UTC.
    await add(errands.id, "Tomorrow at 1am", { dueAt: new Date(startOfDayIn(addDays(today, 1), "Australia/Sydney").getTime() + 3_600_000).toISOString() });
    await add(errands.id, "Next week", { dueDate: addDays(today, 7) });
    await add(errands.id, "Undated");
    expect(await titles("due:today")).toEqual(["Today"]);
    expect(await titles("due:tomorrow")).toEqual(["Tomorrow at 1am"]);
    expect(await titles("due:<=today")).toEqual(["Overdue", "Today"]);
    expect(await titles("due:<today")).toEqual(["Overdue"]);
    expect(await titles("due:>today")).toEqual(["Next week", "Tomorrow at 1am"]);
    expect(await titles("due:>=today-2d due:<7d")).toEqual(["Overdue", "Today", "Tomorrow at 1am"]);
    expect(await titles('due:["today" TO "7d"]')).toEqual(["Next week", "Today", "Tomorrow at 1am"]);
    expect(await titles(`due:${addDays(today, 7)}`)).toEqual(["Next week"]);
    // A missing date isn't "today", so NOT keeps it.
    expect(await titles("-due:today")).toEqual(["Next week", "Overdue", "Tomorrow at 1am", "Undated"]);
  });

  it("has is: and has:", async () => {
    const parent = await add(errands.id, "Parent", { notes: "x", startDate: addDays(today, 3) });
    await add(errands.id, "Child", { parentId: parent.id, dueDate: today, labels: ["next"] });
    await add(errands.id, "Repeats", { dueDate: today, recurRule: "FREQ=WEEKLY", recurFrom: "due" });
    await add(errands.id, "Started", { startDate: today });
    expect(await titles("is:subtask")).toEqual(["Child"]);
    expect(await titles("has:parent")).toEqual(["Child"]);
    expect(await titles("is:recurring")).toEqual(["Repeats"]);
    expect(await titles("is:available")).toEqual(["Child", "Repeats", "Started"]);
    expect(await titles("has:due")).toEqual(["Child", "Repeats"]);
    expect(await titles("-has:due")).toEqual(["Parent", "Started"]);
    expect(await titles("has:notes")).toEqual(["Parent"]);
    expect(await titles("has:labels")).toEqual(["Child"]);
    expect(await titles("has:start start:>today")).toEqual(["Parent"]);
  });

  it("shows open, unsnoozed tasks and no headings, unless the query asks", async () => {
    await add(errands.id, "Open");
    await add(errands.id, "Section", { kind: "heading" });
    await add(errands.id, "Later", { snoozedUntil: "2999-01-01T00:00:00.000Z" });
    const done = await add(errands.id, "Done");
    await api("POST", `/api/tasks/${done.id}/complete`);
    expect(await titles("")).toEqual(["Open"]);
    expect(await titles("is:completed")).toEqual(["Done"]);
    expect(await titles(`completed:today`)).toEqual(["Done"]);
    expect(await titles("is:snoozed")).toEqual(["Later"]);
    expect(await titles("is:heading")).toEqual(["Section"]);
    expect(await titles("", { status: "completed" })).toEqual(["Done"]);
    expect(await titles("", { status: "all" })).toEqual(["Done", "Open"]);
  });

  it("lifts sort: and group: from the top level, the parameters winning", async () => {
    await add(errands.id, "B", { dueDate: addDays(today, 2) });
    await add(errands.id, "A", { dueDate: addDays(today, 1) });
    await add(errands.id, "C");
    const r = await search('sort:due group:"label:wip,next"');
    expect(r.tasks.map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(r.sort).toEqual({ by: "due", desc: false });
    expect(r.group).toEqual({ by: "label", labels: ["wip", "next"] });
    const d = await search("sort:due-desc");
    expect(d.tasks.map((t) => t.title)).toEqual(["B", "A", "C"]);
    const p = await search("sort:due group:due", { sort: "title-desc", group: "none" });
    expect(p.tasks.map((t) => t.title)).toEqual(["C", "B", "A"]);
    expect(p.group).toEqual({ by: "none" });
    expect((await search("")).sort).toEqual({ by: "list", desc: false });
    expect((await search("")).group).toEqual({ by: "list" });
  });

  it("explains problems with the column they're at", async () => {
    expect(await failure("colour:red")).toMatchObject({ code: "invalid_query", issues: [{ column: 1 }] });
    expect((await failure("#next | #wip")).message).toContain("use AND or OR");
    expect((await failure("#next | #wip")).issues[0]!.column).toBe(7);
    expect((await failure("due:soon")).message).toContain("needs a date");
    expect((await failure("is:urgent")).message).toContain("is: is one of");
    expect((await failure("label:>next")).message).toContain("can't be compared");
    expect((await failure("#next OR sort:due")).message).toContain("top level");
    expect((await failure("sort:colour")).message).toContain("sort:");
    expect((await failure("(#next")).message).toContain("isn't finished");
  });

  it("rejects bad sort and group parameters", async () => {
    expect((await api("GET", "/api/search?q=&sort=colour")).status).toBe(400);
    expect((await api("GET", "/api/search?q=&group=label:")).status).toBe(400);
  });
});
