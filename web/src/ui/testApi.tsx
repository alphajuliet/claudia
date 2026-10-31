/** Fixtures and a stateful fake API for the screen tests. Not a test file itself. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Filter, Folder, List, Task } from "@claudia/shared";
import { todayIn } from "../lib/dates";
import { SessionProvider } from "../session/SessionProvider";
import { tokenStore } from "../session/store";
import { AppShell } from "./AppShell";

export const me = { name: "laptop", scopes: ["write"], expiresAt: null };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export const at = "2026-10-31T00:00:00.000Z";
export const today = todayIn("Australia/Sydney");
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const work: Folder = { id: "01JC0000000000000000000001", name: "Acme", parentId: null, context: "work", position: "a0", createdAt: at, updatedAt: at };
export const personal: Folder = { id: "01JC0000000000000000000002", name: "Life", parentId: null, context: "personal", position: "a1", createdAt: at, updatedAt: at };
const list = (id: string, name: string, folderId: string | null, position = "a0"): List =>
  ({ id, name, folderId, position, archivedAt: null, createdAt: at, updatedAt: at });
// The Inbox sorts after Errands by position, but views still put it first.
export const inbox = list("01JA0000000000000000000001", "Inbox", null, "a5");
export const errands = list("01JA0000000000000000000004", "Errands", null, "a0");
export const projects = list("01JA0000000000000000000002", "Projects", work.id);
export const garden = list("01JA0000000000000000000003", "Garden", personal.id);

let seq = 0;
/** A task with a fresh ULID (`01JB…` plus a counter in valid Crockford digits). */
export const task = (fields: Partial<Task> & Pick<Task, "title" | "listId">): Task => ({
  id: `01JB00000000000000000${String(++seq).padStart(5, "0")}`, parentId: null, kind: "task", position: `a${seq}`,
  notes: null, dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null,
  completedAt: null, labels: [], metadata: null, createdAt: at, updatedAt: at, ...fields,
});

export interface StubOptions {
  failComplete?: boolean;
  failCreate?: boolean;
  failUpdate?: boolean;
  failMove?: boolean;
  holdComplete?: Promise<void>;
  holdRefetch?: Promise<void>;
  filters?: Filter[];
  lists?: List[];
}

/**
 * A small fake of the API: tasks are filtered by listId, parentId, label, dueBefore and status; complete/uncomplete
 * change them along with their subtasks; POST /api/tasks creates, GET /api/tasks/{id} reads, PATCH updates (a
 * recurRule not starting "FREQ=" is refused with a 422, as is a rule without recurFrom), move changes list (to the
 * top level, taking subtasks along, as the server does) and DELETE removes a task and its subtasks. `holdRefetch`
 * holds task GETs made after the first complete or uncomplete.
 */
export function stubApi(tasks: Task[], opts: StubOptions = {}) {
  const store = new Map(tasks.map((t) => [t.id, t]));
  const bodies: Record<string, unknown> = {
    "/api/me": me,
    "/api/folders": [work, personal],
    "/api/lists": opts.lists ?? [inbox, errands, projects, garden],
    "/api/filters": opts.filters ?? [],
    "/api/settings": {},
    "/api/labels": [],
  };
  const descendants = (id: string): Task[] =>
    [...store.values()].filter((t) => t.parentId === id).flatMap((t) => [t, ...descendants(t.id)]);
  const fail = (message: string) => json({ error: { code: "internal", message } }, 500);
  let changed = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path in bodies) return json(bodies[path]);
    const [pathname, search = ""] = path.split("?");
    if (pathname === "/api/tasks" && init?.method === "POST") {
      if (opts.failCreate) return fail("Boom");
      const body = JSON.parse(String(init.body)) as Partial<Task> & Pick<Task, "title" | "listId">;
      const created = task(body);
      store.set(created.id, created);
      return json(created, 201);
    }
    if (pathname === "/api/tasks") {
      if (changed) await opts.holdRefetch;
      const q = new URLSearchParams(search);
      const out = [...store.values()].filter((t) =>
        (q.get("status") !== "open" || t.completedAt === null)
        && (!q.get("listId") || t.listId === q.get("listId"))
        && (!q.get("parentId") || t.parentId === q.get("parentId"))
        && (!q.get("label") || t.labels.includes(q.get("label")!))
        && (!q.get("dueBefore") || (t.dueDate !== null && t.dueDate <= q.get("dueBefore")!)));
      return json(out);
    }
    // A saved filter here matches every task, completed ones included.
    if (/^\/api\/filters\/\w+\/tasks$/.test(pathname!)) return json([...store.values()]);
    const one = pathname!.match(/^\/api\/tasks\/(\w+)$/);
    if (one && !store.has(one[1]!)) return json({ error: { code: "not_found", message: "Task not found" } }, 404);
    if (one && (!init?.method || init.method === "GET")) return json(store.get(one[1]!));
    if (one && init?.method === "PATCH") {
      if (opts.failUpdate) return fail("Boom");
      const saved = { ...store.get(one[1]!)!, ...(JSON.parse(String(init.body)) as Partial<Task>) };
      if ((saved.recurRule === null) !== (saved.recurFrom === null))
        return json({ error: { code: "invalid_recurrence", message: "recurRule and recurFrom must be set together" } }, 422);
      if (saved.recurRule !== null && !saved.recurRule.startsWith("FREQ="))
        return json({ error: { code: "invalid_recurrence", message: "recurRule must be a daily or longer RRULE such as FREQ=WEEKLY;BYDAY=MO" } }, 422);
      store.set(saved.id, saved);
      return json(saved);
    }
    if (one && init?.method === "DELETE") {
      for (const x of [store.get(one[1]!)!, ...descendants(one[1]!)]) store.delete(x.id);
      return new Response(null, { status: 204 });
    }
    const move = pathname!.match(/^\/api\/tasks\/(\w+)\/move$/);
    if (move && init?.method === "POST") {
      if (opts.failMove) return fail("Boom");
      const t = store.get(move[1]!);
      if (!t) return json({ error: { code: "not_found", message: "Task not found" } }, 404);
      const { listId = t.listId } = JSON.parse(String(init.body)) as { listId?: string };
      if (listId !== t.listId) for (const d of descendants(t.id)) store.set(d.id, { ...d, listId });
      const saved = { ...t, listId, parentId: listId === t.listId ? t.parentId : null };
      store.set(t.id, saved);
      return json(saved);
    }
    const m = pathname!.match(/^\/api\/tasks\/(\w+)\/(complete|uncomplete)$/);
    if (m && init?.method === "POST") {
      changed = true;
      const t = store.get(m[1]!)!;
      if (m[2] === "complete") {
        await opts.holdComplete;
        if (opts.failComplete) return fail("Boom");
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

/** The JSON bodies sent with `method` to `path`, in order. */
export const sentBodies = (fetchMock: ReturnType<typeof stubApi>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([p, init]) => p === path && init?.method === method)
    .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

export function renderAt(path: string) {
  tokenStore.set("cl_test");
  const location = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Router hook={location.hook}>
          <AppShell />
        </Router>
      </SessionProvider>
    </QueryClientProvider>,
  );
  /** The current address, path and search. */
  const href = () => location.history!.at(-1)!;
  return { ...view, location, href };
}

export const main = () => within(screen.getByRole("main"));
