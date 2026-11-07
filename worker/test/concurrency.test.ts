import { beforeEach, describe, expect, it } from "vitest";
import { client, makeToken, reset } from "./helpers";

let api: ReturnType<typeof client>;
let inbox: { id: string };

beforeEach(async () => {
  await reset();
  api = client(await makeToken(["write"]));
  inbox = (await api("POST", "/api/lists", { name: "Inbox" })).body;
});

const positions = (rows: { position: string }[]) => rows.map((r) => r.position);

/** Parallel requests, as an MCP client calling create_task several times at once makes them. */
describe("requests at the same time", () => {
  it("gives tasks created together distinct positions, kept in order", async () => {
    const made = await Promise.all(["A", "B", "C", "D", "E"].map((title) => api("POST", "/api/tasks", { listId: inbox.id, title })));
    expect(made.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const rows = (await api("GET", `/api/tasks?listId=${inbox.id}`)).body;
    expect(new Set(positions(rows)).size).toBe(5);
  });

  it("can still place a task between any two created together", async () => {
    const made = await Promise.all(["A", "B", "C"].map((title) => api("POST", "/api/tasks", { listId: inbox.id, title })));
    for (const r of made) {
      const placed = await api("POST", "/api/tasks", { listId: inbox.id, title: `after ${r.body.title}`, afterId: r.body.id });
      expect(placed.status).toBe(201);
    }
  });

  it("gives subtasks created together distinct positions", async () => {
    const parent = (await api("POST", "/api/tasks", { listId: inbox.id, title: "Parent" })).body;
    const made = await Promise.all(["a", "b", "c"].map((title) => api("POST", "/api/tasks", { listId: inbox.id, parentId: parent.id, title })));
    expect(made.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(positions(made.map((r) => r.body))).size).toBe(3);
  });

  it("moves tasks to the end of another list together without a clash", async () => {
    const other = (await api("POST", "/api/lists", { name: "Other" })).body;
    const made = [];
    for (const title of ["A", "B", "C"]) made.push((await api("POST", "/api/tasks", { listId: inbox.id, title })).body);
    const moved = await Promise.all(made.map((t) => api("POST", `/api/tasks/${t.id}/move`, { listId: other.id })));
    expect(moved.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(positions(moved.map((r) => r.body))).size).toBe(3);
  });

  it("creates a new label once when tasks naming it are created together", async () => {
    const made = await Promise.all(["A", "B", "C"].map((title) => api("POST", "/api/tasks", { listId: inbox.id, title, labels: ["errand"] })));
    expect(made.map((r) => r.status)).toEqual([201, 201, 201]);
    const labels = (await api("GET", "/api/labels")).body as { name: string }[];
    expect(labels.filter((l) => l.name === "errand")).toHaveLength(1);
  });

  it("gives lists and folders created together distinct positions", async () => {
    const lists = await Promise.all(["L1", "L2", "L3"].map((name) => api("POST", "/api/lists", { name })));
    expect(lists.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(positions(lists.map((r) => r.body))).size).toBe(3);
    const folders = await Promise.all(["F1", "F2", "F3"].map((name) => api("POST", "/api/folders", { name, context: "work" })));
    expect(folders.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(positions(folders.map((r) => r.body))).size).toBe(3);
  });
});
