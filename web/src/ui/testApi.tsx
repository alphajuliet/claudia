/** Fixtures and a stateful fake API for the screen tests. Not a test file itself. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { VIEWS, type Filter, type Folder, type Label, type LabelColour, type List, type Task, type ViewId } from "@claudia/shared";
import { todayIn } from "../lib/dates";
import { listPosition, type ListMove } from "../lib/listMove";
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
  ({ id, name, folderId, position, archivedAt: null, inbox: name === "Inbox", createdAt: at, updatedAt: at });
// The Inbox sorts after Errands by position, but views still put it first.
export const inbox = list("01JA0000000000000000000001", "Inbox", null, "a5");
export const errands = list("01JA0000000000000000000004", "Errands", null, "a0");
export const projects = list("01JA0000000000000000000002", "Projects", work.id);
export const garden = list("01JA0000000000000000000003", "Garden", personal.id);

let seq = 0;
/**
 * A task with a fresh ULID (`01JB…` plus a counter in valid Crockford digits), placed after the ones made before it
 * (a valid fractional index, so moves can place others around it).
 */
export const task = (fields: Partial<Task> & Pick<Task, "title" | "listId">): Task => ({
  id: `01JB00000000000000000${String(++seq).padStart(5, "0")}`, parentId: null, kind: "task", position: `a${String(seq).padStart(5, "0")}V`,
  notes: null, dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null, priority: "normal",
  completedAt: null, labels: [], metadata: null, createdAt: at, updatedAt: at, ...fields,
});

export interface StubOptions {
  folders?: Folder[];
  failComplete?: boolean;
  failCreate?: boolean;
  failUpdate?: boolean;
  failMove?: boolean;
  failRename?: boolean;
  holdComplete?: Promise<void>;
  holdRefetch?: Promise<void>;
  /** Called for each PATCH and move before it is applied: it may hold the request, and a rejection fails it. */
  gate?: (method: string, path: string, body: unknown) => Promise<void> | undefined;
  filters?: Filter[];
  lists?: List[];
  /** Labels served by GET /api/labels: names, or names with a colour. */
  labels?: (string | { name: string; color: LabelColour | null })[];
  failLabel?: boolean;
}

/**
 * A small fake of the API: tasks are filtered by listId, parentId, label, dueBefore, activeBy, q (title or notes) and status; complete/uncomplete
 * change them along with their subtasks; POST /api/tasks creates, GET /api/tasks/{id} reads, PATCH updates (a
 * recurRule not starting "FREQ=" is refused with a 422, as is a rule without recurFrom), move places a task as the
 * server does (see `moveIn`) and DELETE removes a task and its subtasks. `holdRefetch`
 * holds task GETs made after the first complete or uncomplete.
 */
export function stubApi(tasks: Task[], opts: StubOptions = {}) {
  const store = new Map(tasks.map((t) => [t.id, t]));
  const bodies: Record<string, unknown> = {
    "/api/me": me,
    "/api/folders": opts.folders ?? [work, personal],
    "/api/lists": opts.lists ?? [inbox, errands, projects, garden],
    "/api/filters": opts.filters ?? [],
    "/api/settings": {},
    "/api/labels": (opts.labels ?? []).map((l, i) => ({
      id: `01JD${String(i).padStart(22, "0")}`, ...(typeof l === "string" ? { name: l, color: null } : l), createdAt: at,
    })),
  };
  const descendants = (id: string): Task[] =>
    [...store.values()].filter((t) => t.parentId === id).flatMap((t) => [t, ...descendants(t.id)]);
  const fail = (message: string) => json({ error: { code: "internal", message } }, 500);
  /** False when the gate fails the request. */
  const pass = async (method: string, path: string, body: unknown) => {
    try { await opts.gate?.(method, path, body); return true; } catch { return false; }
  };
  /** A view's tasks: open and unsnoozed (or completed: for Today, today), not headings, in the context's lists. */
  const viewOf = (id: ViewId, context: string, status: "open" | "completed") => {
    const lists = bodies["/api/lists"] as List[];
    const folders = bodies["/api/folders"] as Folder[];
    const inboxId = lists.find((l) => l.inbox && l.archivedAt === null)?.id;
    const shown = new Set<string>();
    const walk = (parentId: string | null) => {
      for (const f of folders) if (f.parentId === parentId && f.context === context) { shown.add(f.id); walk(f.id); }
    };
    walk(null);
    const inContext = (t: Task) =>
      context === "all" || t.listId === inboxId
      || lists.some((l) => l.id === t.listId && l.archivedAt === null && (l.folderId === null || shown.has(l.folderId)));
    const label = VIEWS.find((v) => v.id === id)?.label?.toLowerCase();
    const rule = (t: Task) =>
      id === "inbox" ? t.listId === inboxId
      : id === "today" ? (t.dueDate !== null && t.dueDate <= today) || (t.startDate !== null && t.startDate <= today)
      : t.labels.some((l) => l.toLowerCase() === label);
    const now = new Date().toISOString();
    const state = (t: Task) =>
      status === "open"
        ? t.completedAt === null && (t.snoozedUntil === null || t.snoozedUntil <= now)
        : t.completedAt !== null && (id !== "today" || todayIn("Australia/Sydney", new Date(t.completedAt)) === today);
    return id === "inbox" && !inboxId ? [] : [...store.values()].filter((t) => t.kind === "task" && state(t) && rule(t) && inContext(t));
  };
  let changed = false;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const renamed = path.match(/^\/api\/(lists|folders)\/(\w+)$/);
    if (renamed && init?.method === "PATCH") {
      if (opts.failRename) return fail("Boom");
      const items = bodies[`/api/${renamed[1]}`] as { id: string; name: string }[];
      const { name } = JSON.parse(String(init.body)) as { name: string };
      bodies[`/api/${renamed[1]}`] = items.map((x) => (x.id === renamed[2] ? { ...x, name } : x));
      return json((bodies[`/api/${renamed[1]}`] as { id: string }[]).find((x) => x.id === renamed[2]));
    }
    // Labels: POST creates (a taken name is a 409), PATCH renames or recolours (a rename reaches the tasks) and DELETE
    // takes it off every task.
    if (path === "/api/labels" && init?.method === "POST") {
      if (opts.failLabel) return fail("Boom");
      const items = bodies["/api/labels"] as Label[];
      const body = JSON.parse(String(init.body)) as { name: string; color?: LabelColour | null };
      if (items.some((l) => l.name.toLowerCase() === body.name.toLowerCase()))
        return json({ error: { code: "name_taken", message: `A label named '${body.name}' already exists` } }, 409);
      const made: Label = { id: `01JE${String(items.length).padStart(22, "0")}`, name: body.name, color: body.color ?? null, createdAt: at };
      bodies["/api/labels"] = [...items, made];
      return json(made, 201);
    }
    const label = path.match(/^\/api\/labels\/(\w+)$/);
    if (label && (init?.method === "PATCH" || init?.method === "DELETE")) {
      if (opts.failLabel) return fail("Boom");
      const items = bodies["/api/labels"] as Label[];
      const before = items.find((l) => l.id === label[1]);
      if (!before) return json({ error: { code: "not_found", message: "Label not found" } }, 404);
      const has = (t: Task) => t.labels.some((n) => n.toLowerCase() === before.name.toLowerCase());
      if (init.method === "DELETE") {
        bodies["/api/labels"] = items.filter((l) => l !== before);
        for (const t of store.values()) if (has(t)) store.set(t.id, { ...t, labels: t.labels.filter((n) => n.toLowerCase() !== before.name.toLowerCase()) });
        return new Response(null, { status: 204 });
      }
      const change = JSON.parse(String(init.body)) as { name?: string; color?: LabelColour | null };
      const after = { ...before, ...change };
      bodies["/api/labels"] = items.map((l) => (l === before ? after : l));
      if (change.name !== undefined)
        for (const t of store.values()) if (has(t)) store.set(t.id, { ...t, labels: t.labels.map((n) => (n.toLowerCase() === before.name.toLowerCase() ? after.name : n)) });
      return json(after);
    }
    const movedList = path.match(/^\/api\/lists\/(\w+)\/move$/);
    if (movedList && init?.method === "POST") {
      if (!(await pass("POST", path, init.body))) return fail("Boom");
      const lists = bodies["/api/lists"] as List[];
      const to = JSON.parse(String(init.body)) as ListMove;
      const position = listPosition(lists, movedList[1]!, to)!;
      bodies["/api/lists"] = lists.map((l) => (l.id === movedList[1] ? { ...l, folderId: to.folderId, position } : l));
      return json((bodies["/api/lists"] as List[]).find((l) => l.id === movedList[1]));
    }
    if (path in bodies) return json(bodies[path]);
    if (path === "/api/counts") return json(countsOf([...store.values()]));
    const [pathname, search = ""] = path.split("?");
    if (pathname === "/api/tasks" && init?.method === "POST") {
      if (opts.failCreate) return fail("Boom");
      const { atStart, ...body } = JSON.parse(String(init.body)) as Partial<Task> & Pick<Task, "title" | "listId"> & { atStart?: boolean };
      const first = [...store.values()]
        .filter((t) => t.listId === body.listId && t.parentId === (body.parentId ?? null))
        .sort(byPosition)[0];
      const created = task(atStart ? { ...body, position: generateKeyBetween(null, first?.position ?? null) } : body);
      store.set(created.id, created);
      return json(created, 201);
    }
    if (pathname === "/api/tasks") {
      if (changed) await opts.holdRefetch;
      const q = new URLSearchParams(search);
      const out = [...store.values()].filter((t) =>
        (q.get("status") !== "open" || t.completedAt === null)
        && (q.get("status") !== "completed" || t.completedAt !== null)
        && (!q.get("listId") || t.listId === q.get("listId"))
        && (!q.get("parentId") || t.parentId === q.get("parentId"))
        && (!q.get("label") || t.labels.includes(q.get("label")!))
        && (!q.get("dueBefore") || (t.dueDate !== null && t.dueDate <= q.get("dueBefore")!))
        && (!q.get("activeBy") || (t.dueDate !== null && t.dueDate <= q.get("activeBy")!) || (t.startDate !== null && t.startDate <= q.get("activeBy")!))
        && (!q.get("q") || `${t.title}\n${t.notes ?? ""}`.toLowerCase().includes(q.get("q")!.toLowerCase())));
      return json(out);
    }
    // Views, as worker/src/domain/views.ts decides them (due times aside).
    if (pathname === "/api/views") {
      const context = new URLSearchParams(search).get("context") ?? "all";
      return json(VIEWS.map((v) => ({ id: v.id, name: v.name, label: v.label, count: viewOf(v.id, context, "open").length })));
    }
    const shownView = pathname!.match(/^\/api\/views\/(\w+)\/tasks$/);
    if (shownView) {
      if (changed) await opts.holdRefetch;
      const q = new URLSearchParams(search);
      return json(viewOf(shownView[1] as ViewId, q.get("context") ?? "all", q.get("status") === "completed" ? "completed" : "open"));
    }
    // A saved filter here matches every task, completed ones included (or only those, with status=completed).
    if (/^\/api\/filters\/\w+\/tasks$/.test(pathname!))
      return json([...store.values()].filter((t) => new URLSearchParams(search).get("status") !== "completed" || t.completedAt !== null));
    const one = pathname!.match(/^\/api\/tasks\/(\w+)$/);
    if (one && !store.has(one[1]!)) return json({ error: { code: "not_found", message: "Task not found" } }, 404);
    if (one && (!init?.method || init.method === "GET")) return json(store.get(one[1]!));
    if (one && init?.method === "PATCH") {
      if (opts.failUpdate || !(await pass("PATCH", pathname!, JSON.parse(String(init.body))))) return fail("Boom");
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
      if (opts.failMove || !(await pass("POST", pathname!, JSON.parse(String(init.body))))) return fail("Boom");
      const t = store.get(move[1]!);
      if (!t) return json({ error: { code: "not_found", message: "Task not found" } }, 404);
      const saved = moveIn(store, t, JSON.parse(String(init.body)) as MoveBody);
      return saved ? json(saved) : json({ error: { code: "invalid_placement", message: "Sibling not found in this scope" } }, 422);
    }
    const m = pathname!.match(/^\/api\/tasks\/(\w+)\/(complete|uncomplete)$/);
    if (m && init?.method === "POST") {
      changed = true;
      const t = store.get(m[1]!)!;
      if (m[2] === "complete") {
        await opts.holdComplete;
        if (opts.failComplete) return fail("Boom");
        if (t.recurRule) {
          const saved = { ...t, dueDate: addDays(t.dueDate!, t.recurRule.includes("DAILY") ? 1 : 7) };
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

interface MoveBody { listId?: string; parentId?: string | null; afterId?: string; beforeId?: string; withSection?: boolean }

const byPosition = (a: Task, b: Task) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/**
 * POST /api/tasks/{id}/move, as `worker/src/routes/tasks.ts` does it: the task goes after `afterId`, before
 * `beforeId` or last among its new siblings. Changing list without a parent puts it at the top level there, and
 * its subtasks follow it. With `withSection` a heading's section (the top-level tasks down to the next heading)
 * lands straight after it, in order. Null when the placement isn't a sibling (or is inside the section).
 */
function moveIn(store: Map<string, Task>, t: Task, body: MoveBody): Task | null {
  const all = [...store.values()];
  const listId = body.listId ?? t.listId;
  const parentId = body.parentId !== undefined ? body.parentId : listId === t.listId ? t.parentId : null;
  const section: Task[] = [];
  if (body.withSection) {
    const topLevel = all.filter((x) => x.listId === t.listId && x.parentId === null).sort(byPosition);
    for (const x of topLevel.slice(topLevel.indexOf(t) + 1)) {
      if (x.kind === "heading") break;
      section.push(x);
    }
  }
  const moving = new Set([t.id, ...section.map((x) => x.id)]);
  const siblings = all.filter((x) => x.listId === listId && x.parentId === parentId && !moving.has(x.id)).sort(byPosition);
  const anchor = body.afterId ?? body.beforeId;
  const at = anchor ? siblings.findIndex((x) => x.id === anchor) : siblings.length;
  if (at < 0) return null;
  const [low, high] = body.afterId ? [siblings[at], siblings[at + 1]] : [siblings[at - 1], siblings[at]];
  const position = generateKeyBetween(low?.position ?? null, high?.position ?? null);
  const positions = generateNKeysBetween(position, high?.position ?? null, section.length);
  const subtasks = (id: string): Task[] => all.filter((x) => x.parentId === id).flatMap((x) => [x, ...subtasks(x.id)]);
  if (listId !== t.listId)
    for (const top of [t, ...section]) for (const d of subtasks(top.id)) store.set(d.id, { ...d, listId });
  section.forEach((x, i) => store.set(x.id, { ...x, listId, position: positions[i]! }));
  const saved = { ...t, listId, parentId, position };
  store.set(t.id, saved);
  return saved;
}

/** What `GET /api/counts` would say for these tasks (snoozing and due times aside). */
function countsOf(tasks: Task[]) {
  const lists: Record<string, { open: number; today: number; labels: Record<string, number> }> = {};
  for (const t of tasks) {
    if (t.kind !== "task" || t.completedAt !== null) continue;
    const c = (lists[t.listId] ??= { open: 0, today: 0, labels: {} });
    c.open++;
    if ((t.dueDate !== null && t.dueDate <= today) || (t.startDate !== null && t.startDate <= today)) c.today++;
    for (const l of t.labels) c.labels[l.toLowerCase()] = (c.labels[l.toLowerCase()] ?? 0) + 1;
  }
  return { lists };
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
