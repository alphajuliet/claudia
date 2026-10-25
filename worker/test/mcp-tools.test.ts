// worker/test/mcp-tools.test.ts
import { describe, expect, it } from "vitest";
import { TOOLS, type ToolDef } from "../src/mcp/tools";

const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID2 = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const tool = (name: string): ToolDef => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const req = (name: string, args: object) => {
  const t = tool(name);
  return t.request(t.input.parse(args));
};

describe("tool list", () => {
  it("has the 22 expected tools and no deletes or admin tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "complete_task", "create_folder", "create_filter", "create_label", "create_list", "create_task",
      "get_task", "list_filters", "list_folders", "list_labels", "list_lists", "move_folder", "move_list",
      "move_task", "rename_label", "run_filter", "search_tasks", "uncomplete_task", "update_filter",
      "update_folder", "update_list", "update_task",
    ].sort());
    for (const t of TOOLS) expect(t.name).not.toMatch(/delete|remove|token|import|setting/);
  });

  it("marks exactly the 7 read tools as read", () => {
    expect(TOOLS.filter((t) => t.access === "read").map((t) => t.name).sort()).toEqual([
      "get_task", "list_filters", "list_folders", "list_labels", "list_lists", "run_filter", "search_tasks",
    ]);
  });

  it("gives every tool a description and a unique name", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });
});

describe("request mapping", () => {
  it("search_tasks applies the default limit and passes filters as a query", () => {
    expect(req("search_tasks", {})).toEqual({ method: "GET", path: "/api/tasks", query: { status: "open", limit: 50, offset: 0 } });
    expect(req("search_tasks", { label: "next", dueBefore: "2026-11-01", limit: 10 }).query).toMatchObject({
      label: "next", dueBefore: "2026-11-01", limit: 10,
    });
  });

  it("reads use GET and the id in the path", () => {
    expect(req("get_task", { id: ID })).toEqual({ method: "GET", path: `/api/tasks/${ID}` });
    expect(req("run_filter", { id: ID, limit: 5 })).toEqual({ method: "GET", path: `/api/filters/${ID}/tasks`, query: { limit: 5 } });
    expect(req("list_lists", { archived: true }).query).toEqual({ archived: "true" });
    expect(req("list_folders", {})).toEqual({ method: "GET", path: "/api/folders" });
  });

  it("create_task posts every field it was given, including placement", () => {
    expect(req("create_task", { listId: ID, title: "T", labels: ["next"], afterId: ID2 })).toEqual({
      method: "POST", path: "/api/tasks", body: { listId: ID, title: "T", labels: ["next"], afterId: ID2 },
    });
  });

  it("update and move take the id from the path, not the body", () => {
    expect(req("update_task", { id: ID, title: "New", dueDate: null })).toEqual({
      method: "PATCH", path: `/api/tasks/${ID}`, body: { title: "New", dueDate: null },
    });
    expect(req("move_task", { id: ID, listId: ID2 })).toEqual({ method: "POST", path: `/api/tasks/${ID}/move`, body: { listId: ID2 } });
    expect(req("move_list", { id: ID, folderId: null })).toEqual({ method: "POST", path: `/api/lists/${ID}/move`, body: { folderId: null } });
    expect(req("update_list", { id: ID, archived: true })).toEqual({ method: "PATCH", path: `/api/lists/${ID}`, body: { archived: true } });
    expect(req("rename_label", { id: ID, name: "doing" })).toEqual({ method: "PATCH", path: `/api/labels/${ID}`, body: { name: "doing" } });
  });

  it("complete and uncomplete post with no body", () => {
    expect(req("complete_task", { id: ID })).toEqual({ method: "POST", path: `/api/tasks/${ID}/complete` });
    expect(req("uncomplete_task", { id: ID })).toEqual({ method: "POST", path: `/api/tasks/${ID}/uncomplete` });
  });

  it("creates folders, lists, labels and filters", () => {
    expect(req("create_folder", { name: "F", context: "home" }).body).toEqual({ name: "F", context: "home" });
    expect(req("create_list", { name: "L", folderId: ID }).body).toEqual({ name: "L", folderId: ID });
    expect(req("create_label", { name: "next" })).toEqual({ method: "POST", path: "/api/labels", body: { name: "next" } });
    expect(req("create_filter", { name: "Soon", query: "dueBefore=2026-11-01" }).path).toBe("/api/filters");
    expect(req("update_filter", { id: ID, query: "label=next" })).toEqual({ method: "PATCH", path: `/api/filters/${ID}`, body: { query: "label=next" } });
  });
});

describe("input validation", () => {
  it("rejects bad ids, dates and unknown fields", () => {
    expect(() => req("get_task", { id: "nope" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "T", dueDate: "tomorrow" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "" })).toThrow();
    expect(() => req("create_task", { listId: ID, title: "T", surprise: 1 })).toThrow();
    expect(() => req("move_task", { id: ID, afterId: ID, beforeId: ID2 })).toThrow();
  });
});
