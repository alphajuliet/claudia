import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Filter, Folder, List, Task } from "@claudia/shared";
import { formatDue, todayIn } from "../lib/dates";
import { SessionProvider } from "../session/SessionProvider";
import { tokenStore } from "../session/store";
import { AppShell } from "./AppShell";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const at = "2026-10-31T00:00:00.000Z";
const today = todayIn("Australia/Sydney");
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const work: Folder = { id: "01JC0000000000000000000001", name: "Acme", parentId: null, context: "work", position: "a0", createdAt: at, updatedAt: at };
const personal: Folder = { id: "01JC0000000000000000000002", name: "Life", parentId: null, context: "personal", position: "a1", createdAt: at, updatedAt: at };
const list = (id: string, name: string, folderId: string | null, position = "a0"): List =>
  ({ id, name, folderId, position, archivedAt: null, createdAt: at, updatedAt: at });
// The Inbox sorts after Errands by position, but views still put it first.
const inbox = list("01JA0000000000000000000001", "Inbox", null, "a5");
const errands = list("01JA0000000000000000000004", "Errands", null, "a0");
const projects = list("01JA0000000000000000000002", "Projects", work.id);
const garden = list("01JA0000000000000000000003", "Garden", personal.id);

let seq = 0;
const task = (fields: Partial<Task> & Pick<Task, "title" | "listId">): Task => ({
  id: `01JB00000000000000000000${String(++seq).padStart(2, "0")}`, parentId: null, kind: "task", position: `a${seq}`,
  notes: null, dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null,
  completedAt: null, labels: [], metadata: null, createdAt: at, updatedAt: at, ...fields,
});

/**
 * A small fake of the API: tasks are filtered by listId, label and status, and complete/uncomplete change them
 * along with their subtasks. `holdRefetch` holds task GETs made after the first complete or uncomplete.
 */
function stubApi(tasks: Task[], opts: { failComplete?: boolean; holdComplete?: Promise<void>; holdRefetch?: Promise<void>; filters?: Filter[] } = {}) {
  const store = new Map(tasks.map((t) => [t.id, t]));
  const bodies: Record<string, unknown> = {
    "/api/me": me,
    "/api/folders": [work, personal],
    "/api/lists": [inbox, errands, projects, garden],
    "/api/filters": opts.filters ?? [],
    "/api/settings": {},
  };
  const descendants = (id: string): Task[] =>
    [...store.values()].filter((t) => t.parentId === id).flatMap((t) => [t, ...descendants(t.id)]);
  let changed = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path in bodies) return json(bodies[path]);
    const [pathname, search = ""] = path.split("?");
    if (pathname === "/api/tasks") {
      if (changed) await opts.holdRefetch;
      const q = new URLSearchParams(search);
      const out = [...store.values()].filter((t) =>
        (q.get("status") !== "open" || t.completedAt === null)
        && (!q.get("listId") || t.listId === q.get("listId"))
        && (!q.get("label") || t.labels.includes(q.get("label")!)));
      return json(out);
    }
    // A saved filter here matches every task, completed ones included.
    if (/^\/api\/filters\/\w+\/tasks$/.test(pathname!)) return json([...store.values()]);
    const m = pathname!.match(/^\/api\/tasks\/(\w+)\/(complete|uncomplete)$/);
    if (m && init?.method === "POST") {
      changed = true;
      const t = store.get(m[1]!)!;
      if (m[2] === "complete") {
        await opts.holdComplete;
        if (opts.failComplete) return json({ error: { code: "internal", message: "Boom" } }, 500);
        if (t.recurRule) {
          const saved = { ...t, dueDate: addDays(t.dueDate!, 7) };
          store.set(t.id, saved);
          return json({ ...saved, subtasks: 0 });
        }
        const subtasks = descendants(t.id).filter((d) => d.completedAt === null);
        for (const x of [t, ...subtasks]) store.set(x.id, { ...x, completedAt: at });
        return json({ ...store.get(t.id), subtasks: subtasks.length });
      }
      const subtasks = descendants(t.id).filter((d) => d.completedAt !== null && d.completedAt === t.completedAt);
      for (const x of [t, ...subtasks]) store.set(x.id, { ...x, completedAt: null });
      return json({ ...store.get(t.id), subtasks: subtasks.length });
    }
    return json({ error: { code: "not_found", message: "Not found" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  tokenStore.set("cl_test");
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Router hook={location.hook}>
          <AppShell />
        </Router>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

const main = () => within(screen.getByRole("main"));
const groupTitles = () => main().getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("task lists", () => {
  it("groups a view by list in sidebar order, Inbox first, and hides snoozed tasks", async () => {
    stubApi([
      task({ title: "Weed the beds", listId: garden.id, labels: ["next"] }),
      task({ title: "Draft the brief", listId: projects.id, labels: ["next"] }),
      task({ title: "Buy stamps", listId: errands.id, labels: ["next"] }),
      task({ title: "Sort the post", listId: inbox.id, labels: ["next"] }),
      task({ title: "Later, maybe", listId: garden.id, labels: ["next"], snoozedUntil: "2999-01-01T00:00:00.000Z" }),
      task({ title: "Not next", listId: garden.id }),
    ]);
    renderAt("/next");
    expect(await main().findByText("Weed the beds")).toBeTruthy();
    expect(groupTitles()).toEqual(["Inbox", "Errands", "Projects", "Garden"]);
    expect(main().queryByText("Later, maybe")).toBeNull();
    expect(main().queryByText("Not next")).toBeNull();
    const projectsGroup = within(screen.getByRole("region", { name: "Projects" }));
    expect(projectsGroup.getByRole("checkbox", { name: "Complete Draft the brief" })).toBeTruthy();
  });

  it("narrows a view to the current context", async () => {
    localStorage.setItem("claudia.context", "work");
    stubApi([
      task({ title: "Weed the beds", listId: garden.id, labels: ["next"] }),
      task({ title: "Draft the brief", listId: projects.id, labels: ["next"] }),
      task({ title: "Sort the post", listId: inbox.id, labels: ["next"] }),
    ]);
    renderAt("/next");
    expect(await main().findByText("Draft the brief")).toBeTruthy();
    expect(main().getByText("Sort the post")).toBeTruthy();
    expect(main().queryByText("Weed the beds")).toBeNull();
  });

  it("shows a list in outline order with subtasks indented and headings as section titles", async () => {
    const parent = task({ title: "Plan the trip", listId: garden.id });
    stubApi([
      parent,
      task({ title: "Book flights", listId: garden.id, parentId: parent.id }),
      task({ title: "Spring", listId: garden.id, kind: "heading" }),
      task({ title: "Plant tomatoes", listId: garden.id, labels: ["wip"], dueDate: addDays(today, -2) }),
    ]);
    renderAt(`/list/${garden.id}`);
    expect(await main().findByText("Book flights")).toBeTruthy();
    expect(main().getByRole("heading", { level: 1, name: "Garden" })).toBeTruthy();
    expect(main().getByRole("heading", { level: 2, name: "Spring" })).toBeTruthy();
    expect(main().queryByRole("checkbox", { name: "Complete Spring" })).toBeNull();

    const rows = main().getAllByRole("listitem");
    expect(rows.map((r) => r.textContent?.includes("Plan the trip") ? "parent" : r.textContent?.includes("Book flights") ? "child" : "other").slice(0, 2))
      .toEqual(["parent", "child"]);
    expect(rows[0]!.getAttribute("data-depth")).toBe("0");
    expect(rows[1]!.getAttribute("data-depth")).toBe("1");

    const overdue = main().getByText(formatDue(addDays(today, -2), today).text);
    expect(overdue.classList.contains("overdue")).toBe(true);
    expect(main().getByText("wip")).toBeTruthy();
  });

  it("renders the Inbox list at its own address", async () => {
    stubApi([task({ title: "Sort the post", listId: inbox.id })]);
    renderAt(`/list/${inbox.id}`);
    expect(await main().findByText("Sort the post")).toBeTruthy();
    expect(main().getByRole("heading", { level: 1, name: "Inbox" })).toBeTruthy();
  });

  it("shows empty states", async () => {
    stubApi([]);
    renderAt("/inbox");
    expect(await main().findByText("Inbox zero.")).toBeTruthy();
  });

  it("shows an error with Try again", async () => {
    stubApi([]);
    const fetchMock = vi.mocked(fetch);
    const real = fetchMock.getMockImplementation()!;
    let failing = true;
    fetchMock.mockImplementation(async (path, init) =>
      failing && String(path).startsWith("/api/tasks?") ? json({ error: { code: "internal", message: "Database unavailable" } }, 500) : real(path, init));
    renderAt("/next");
    expect(await main().findByText("Database unavailable")).toBeTruthy();
    failing = false;
    await userEvent.click(main().getByRole("button", { name: "Try again" }));
    expect(await main().findByText("Nothing here.")).toBeTruthy();
  });

  it("completes a plain task, removes it and offers Undo", async () => {
    const plain = task({ title: "Buy stamps", listId: errands.id, labels: ["next"] });
    const fetchMock = stubApi([plain]);
    renderAt("/next");
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Buy stamps" }));
    expect(main().queryByText("Buy stamps")).toBeNull();
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("Completed “Buy stamps”"));

    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks/${plain.id}/uncomplete`, expect.objectContaining({ method: "POST" }));
    expect(await main().findByText("Buy stamps")).toBeTruthy();
  });

  it("completes a task with its subtasks, says how many and offers Undo", async () => {
    const parent = task({ title: "Plan the trip", listId: garden.id });
    const child = task({ title: "Book flights", listId: garden.id, parentId: parent.id });
    const grandchild = task({ title: "Choose seats", listId: garden.id, parentId: child.id });
    let release!: () => void;
    const fetchMock = stubApi([parent, child, grandchild, task({ title: "Plant tomatoes", listId: garden.id })],
      { holdComplete: new Promise((resolve) => { release = resolve; }) });
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Plan the trip" }));
    expect(main().queryByText("Plan the trip")).toBeNull();
    expect(main().queryByText("Book flights")).toBeNull();
    expect(main().queryByText("Choose seats")).toBeNull();
    expect(main().getByText("Plant tomatoes")).toBeTruthy();

    release();
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("Completed “Plan the trip” and 2 subtasks"));
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks/${parent.id}/uncomplete`, expect.objectContaining({ method: "POST" }));
    expect(await main().findByText("Choose seats")).toBeTruthy();
    expect(main().getByText("Book flights")).toBeTruthy();
  });

  it("says subtask for just one", async () => {
    const parent = task({ title: "Plan the trip", listId: garden.id });
    stubApi([parent, task({ title: "Book flights", listId: garden.id, parentId: parent.id })]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Plan the trip" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Completed “Plan the trip” and 1 subtask"));
    expect(screen.getByRole("status").textContent).not.toContain("subtasks");
  });

  it("restores a task and its subtasks when completing fails", async () => {
    const parent = task({ title: "Plan the trip", listId: garden.id });
    stubApi([parent, task({ title: "Book flights", listId: garden.id, parentId: parent.id })], { failComplete: true });
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Plan the trip" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(main().getByText("Plan the trip")).toBeTruthy();
    expect(main().getByText("Book flights")).toBeTruthy();
    const rows = main().getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-depth"))).toEqual(["0", "1"]);
  });

  it("shows the toast as soon as the server answers, without waiting for the refetch", async () => {
    let release!: () => void;
    stubApi([task({ title: "Buy stamps", listId: errands.id, labels: ["next"] })],
      { holdRefetch: new Promise((resolve) => { release = resolve; }) });
    renderAt("/next");
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Buy stamps" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Completed “Buy stamps”"));
    release();
  });

  it("completes a repeating task, keeps it and shows its next due date", async () => {
    stubApi([task({ title: "Water the plants", listId: garden.id, labels: ["next"], dueDate: today, recurRule: "FREQ=WEEKLY" })]);
    renderAt("/next");
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Water the plants" }));
    const next = formatDue(addDays(today, 7), today).text;
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(`Next due ${next}`));
    expect(main().getByText("Water the plants")).toBeTruthy();
    expect(main().getByText(next)).toBeTruthy();
  });

  it("restores the row and shows the error when completing fails", async () => {
    stubApi([task({ title: "Buy stamps", listId: errands.id, labels: ["next"] })], { failComplete: true });
    renderAt("/next");
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Buy stamps" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(main().getByRole("checkbox", { name: "Complete Buy stamps" })).toBeTruthy();
  });

  it("sends one completion for a double click and disables the checkbox while it runs", async () => {
    let release!: () => void;
    const fetchMock = stubApi(
      [task({ title: "Water the plants", listId: garden.id, labels: ["next"], dueDate: today, recurRule: "FREQ=WEEKLY" })],
      { holdComplete: new Promise((resolve) => { release = resolve; }) },
    );
    renderAt("/next");
    const box = await main().findByRole("checkbox", { name: "Complete Water the plants" });
    await userEvent.dblClick(box);
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(box.closest("li")!.classList.contains("pending")).toBe(true);

    release();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Next due"));
    const posts = fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/complete"));
    expect(posts).toHaveLength(1);
    await waitFor(() => expect((main().getByRole("checkbox", { name: "Complete Water the plants" }) as HTMLInputElement).disabled).toBe(false));
  });

  it("shows a saved filter's open tasks, asking for up to 500", async () => {
    const errand: Filter = { id: "01JD0000000000000000000001", name: "Errands", query: "label=errand", position: "a0", createdAt: at, updatedAt: at };
    const fetchMock = stubApi([
      task({ title: "Buy stamps", listId: errands.id }),
      task({ title: "Post the parcel", listId: errands.id, completedAt: at }),
    ], { filters: [errand] });
    renderAt(`/filter/${errand.id}`);
    expect(await main().findByText("Buy stamps")).toBeTruthy();
    expect(main().queryByText("Post the parcel")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`/api/filters/${errand.id}/tasks?limit=500`, expect.anything());
  });
});
