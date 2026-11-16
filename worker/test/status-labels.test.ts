import { beforeEach, describe, expect, it } from "vitest";
import { client, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let listId: string;

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]), { "X-Claudia-Client": "web" });
  listId = (await api("POST", "/api/lists", { name: "Inbox" })).body.id;
  for (const name of ["next", "waitingOn", "wip"]) await api("POST", "/api/labels", { name, status: true });
  await api("POST", "/api/labels", { name: "errand" });
});

const labelsOf = async () => (await api("GET", "/api/labels")).body as { id: string; name: string; status: boolean; statusPosition: string | null }[];
const statusOrder = async () => (await labelsOf()).filter((l) => l.status).sort((a, b) => (a.statusPosition! < b.statusPosition! ? -1 : 1)).map((l) => l.name);
const byName = async (name: string) => (await labelsOf()).find((l) => l.name === name)!;

describe("status labels", () => {
  it("are flagged and ordered, and can be turned on and off and reordered", async () => {
    expect(await statusOrder()).toEqual(["next", "waitingOn", "wip"]);
    expect(await byName("errand")).toMatchObject({ status: false, statusPosition: null });

    const errand = await byName("errand");
    expect((await api("PATCH", `/api/labels/${errand.id}`, { status: true })).body).toMatchObject({ status: true });
    expect(await statusOrder()).toEqual(["next", "waitingOn", "wip", "errand"]);
    const wip = await byName("wip");
    expect((await api("POST", `/api/labels/${wip.id}/move`, { beforeId: (await byName("next")).id })).status).toBe(200);
    expect(await statusOrder()).toEqual(["wip", "next", "waitingOn", "errand"]);
    await api("PATCH", `/api/labels/${errand.id}`, { status: false });
    expect(await statusOrder()).toEqual(["wip", "next", "waitingOn"]);
    expect((await api("POST", `/api/labels/${errand.id}/move`, {})).status).toBe(422);
  });

  it("are one to a task: a new one replaces the old, and other labels stay", async () => {
    const t = (await api("POST", "/api/tasks", { listId, title: "Call Sam", labels: ["errand", "next"] })).body;
    expect(t.labels).toEqual(["errand", "next"]);
    // Adding wip to next: wip wins.
    expect((await api("PATCH", `/api/tasks/${t.id}`, { labels: ["errand", "next", "wip"] })).body.labels).toEqual(["errand", "wip"]);
    // In any case, and in any order.
    expect((await api("PATCH", `/api/tasks/${t.id}`, { labels: ["WAITINGON", "wip"] })).body.labels).toEqual(["waitingOn"]);
    // Several new ones: the last given wins.
    const u = (await api("POST", "/api/tasks", { listId, title: "Plan", labels: ["next", "wip", "errand"] })).body;
    expect(u.labels).toEqual(["errand", "wip"]);
    // An ordinary label isn't affected.
    expect((await api("PATCH", `/api/tasks/${u.id}`, { labels: ["errand", "wip", "brand-new"] })).body.labels).toEqual(["brand-new", "errand", "wip"]);
  });

  it("group and filter in search", async () => {
    await api("POST", "/api/tasks", { listId, title: "Waiting", labels: ["waitingOn"] });
    await api("POST", "/api/tasks", { listId, title: "Plain", labels: ["errand"] });
    const titles = async (q: string) =>
      (await api("GET", `/api/search?q=${encodeURIComponent(q)}`)).body.tasks.map((t: { title: string }) => t.title);
    expect(await titles("has:status")).toEqual(["Waiting"]);
    expect(await titles("-has:status")).toEqual(["Plain"]);
    expect((await api("GET", `/api/search?q=${encodeURIComponent("group:status")}`)).body.group).toEqual({ by: "status" });
  });
});
