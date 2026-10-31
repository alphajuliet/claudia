import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Label, List, Task } from "@claudia/shared";
import { SessionProvider } from "../session/SessionProvider";
import { tokenStore } from "../session/store";
import { useCreateTask, useDeleteTask, useLabels, useLists, useMoveTask, useSetCompleted, useTasks, useUpdateTask } from "./queries";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const at = "2026-10-31T00:00:00.000Z";

const list: List = { id: "01JA0000000000000000000001", name: "Home", folderId: null, position: "a0", archivedAt: null, createdAt: at, updatedAt: at };
const task: Task = {
  id: "01JB0000000000000000000001", listId: list.id, parentId: null, kind: "task", position: "a0", title: "Water the plants",
  notes: null, dueDate: null, dueAt: null, startDate: null, snoozedUntil: null, recurRule: null, recurFrom: null,
  completedAt: null, labels: [], metadata: null, createdAt: at, updatedAt: at,
};

/** Stubs fetch: /api/me signs in, other paths go to `route`. */
function stubApi(route: (path: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => (path === "/api/me" ? Promise.resolve(json(me)) : route(path, init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function signedIn() {
  tokenStore.set("cl_test");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}

describe("queries", () => {
  it("useLists fetches and parses the lists", async () => {
    stubApi(async (path) => (path === "/api/lists" ? json([list]) : json({}, 404)));
    const { wrapper } = signedIn();
    const { result } = renderHook(() => useLists(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([list]));
  });

  it("useTasks(null) makes no request", async () => {
    const fetchMock = stubApi(async () => json([]));
    const { wrapper } = signedIn();
    const { result } = renderHook(() => useTasks(null), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/me"]);
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useSetCompleted removes a plain task at once and restores it when the server fails", async () => {
    let fail!: () => void;
    stubApi((path) => {
      if (path.startsWith("/api/tasks?")) return Promise.resolve(json([task]));
      if (path === `/api/tasks/${task.id}/complete`)
        return new Promise<Response>((resolve) => { fail = () => resolve(json({ error: { code: "internal", message: "Boom" } }, 500)); });
      return Promise.resolve(json({}, 404));
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), setCompleted: useSetCompleted() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));

    act(() => result.current.setCompleted.mutate({ task, done: true }));
    await waitFor(() => expect(result.current.tasks.data).toEqual([]));

    act(() => fail());
    await waitFor(() => expect(result.current.setCompleted.error?.message).toBe("Boom"));
    expect(result.current.tasks.data).toEqual([task]);
  });

  it("useSetCompleted keeps overlapping completions and puts back only the one that fails", async () => {
    const a = task;
    const b: Task = { ...task, id: "01JB0000000000000000000002", title: "Feed the cat", position: "a1" };
    let server = [a, b];
    let heldGets: Promise<void> | null = null;
    const pending: Record<string, (res: Response) => void> = {};
    stubApi((path) => {
      if (path.startsWith("/api/tasks?")) return Promise.resolve(heldGets).then(() => json(server));
      const m = path.match(/^\/api\/tasks\/(\w+)\/complete$/);
      if (m) return new Promise<Response>((resolve) => { pending[m[1]!] = resolve; });
      return Promise.resolve(json({}, 404));
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), a: useSetCompleted(), b: useSetCompleted() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([a, b]));

    act(() => result.current.a.mutate({ task: a, done: true }));
    act(() => result.current.b.mutate({ task: b, done: true }));
    await waitFor(() => expect(result.current.tasks.data).toEqual([]));
    await waitFor(() => expect(Object.keys(pending)).toHaveLength(2));

    // B succeeds while A is still running: no refetch yet, so A doesn't flicker back.
    server = [a];
    act(() => pending[b.id]!(json({ ...b, completedAt: at, subtasks: 0 })));
    await waitFor(() => expect(result.current.b.isSuccess).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.tasks.data).toEqual([]);

    // A fails: only A comes back, before the refetch answers.
    let releaseGets!: () => void;
    heldGets = new Promise((resolve) => { releaseGets = resolve; });
    act(() => pending[a.id]!(json({ error: { code: "internal", message: "Boom" } }, 500)));
    await waitFor(() => expect(result.current.tasks.data).toEqual([a]));
    act(() => releaseGets());
    await waitFor(() => expect(result.current.a.error?.message).toBe("Boom"));
    expect(result.current.tasks.data).toEqual([a]);
  });

  it("useLabels fetches and parses the labels", async () => {
    const label: Label = { id: "01JC0000000000000000000001", name: "next", createdAt: at };
    stubApi(async (path) => (path === "/api/labels" ? json([label]) : json({}, 404)));
    const { wrapper } = signedIn();
    const { result } = renderHook(() => useLabels(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([label]));
  });

  it("useCreateTask posts the task and refetches the lists", async () => {
    const created: Task = { ...task, id: "01JB0000000000000000000002", title: "Feed the cat", labels: ["next"] };
    let server = [task];
    const fetchMock = stubApi(async (path, init) => {
      if (path.startsWith("/api/tasks?")) return json(server);
      if (path === "/api/tasks" && init?.method === "POST") { server = [task, created]; return json(created, 201); }
      return json({}, 404);
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), create: useCreateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));

    let saved: Task | undefined;
    await act(async () => { saved = await result.current.create.mutateAsync({ listId: list.id, title: "Feed the cat", labels: ["next"] }); });
    expect(saved).toEqual(created);
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/tasks")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ listId: list.id, title: "Feed the cat", labels: ["next"] });
    expect(new Headers(post[1]!.headers).get("Content-Type")).toBe("application/json");
    await waitFor(() => expect(result.current.tasks.data).toEqual([task, created]));
  });

  it("useUpdateTask changes a task at once and restores it when the server fails", async () => {
    let fail!: () => void;
    const fetchMock = stubApi((path, init) => {
      if (path.startsWith("/api/tasks?")) return Promise.resolve(json([task]));
      if (path === `/api/tasks/${task.id}` && init?.method === "PATCH")
        return new Promise<Response>((resolve) => { fail = () => resolve(json({ error: { code: "internal", message: "Boom" } }, 500)); });
      return Promise.resolve(json({}, 404));
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), update: useUpdateTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));

    act(() => result.current.update.mutate({ id: task.id, patch: { title: "Water the ferns", labels: ["home"] } }));
    await waitFor(() => expect(result.current.tasks.data).toEqual([{ ...task, title: "Water the ferns", labels: ["home"] }]));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ title: "Water the ferns", labels: ["home"] });

    act(() => fail());
    await waitFor(() => expect(result.current.update.error?.message).toBe("Boom"));
    expect(result.current.tasks.data).toEqual([task]);
  });

  it("useMoveTask posts the move and refetches the lists", async () => {
    const other = "01JA0000000000000000000002";
    let server = [task];
    const fetchMock = stubApi(async (path, init) => {
      if (path.startsWith("/api/tasks?")) return json(server);
      if (path === `/api/tasks/${task.id}/move` && init?.method === "POST") { server = [{ ...task, listId: other }]; return json(server[0]); }
      return json({}, 404);
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), move: useMoveTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));

    await act(async () => { await result.current.move.mutateAsync({ id: task.id, listId: other }); });
    const post = fetchMock.mock.calls.find((c) => c[0] === `/api/tasks/${task.id}/move`)!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ listId: other });
    await waitFor(() => expect(result.current.tasks.data).toEqual([{ ...task, listId: other }]));
  });

  it("useDeleteTask removes a task and its subtask at once and restores them when the server fails", async () => {
    const child: Task = { ...task, id: "01JB0000000000000000000002", parentId: task.id, title: "Buy compost" };
    let fail!: () => void;
    stubApi((path, init) => {
      if (path.startsWith("/api/tasks?")) return Promise.resolve(json([task, child]));
      if (path === `/api/tasks/${task.id}` && init?.method === "DELETE")
        return new Promise<Response>((resolve) => { fail = () => resolve(json({ error: { code: "internal", message: "Boom" } }, 500)); });
      return Promise.resolve(json({}, 404));
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), remove: useDeleteTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task, child]));

    act(() => result.current.remove.mutate({ task }));
    await waitFor(() => expect(result.current.tasks.data).toEqual([]));

    act(() => fail());
    await waitFor(() => expect(result.current.remove.error?.message).toBe("Boom"));
    expect(result.current.tasks.data).toEqual([task, child]);
  });

  it("useDeleteTask accepts the empty 204", async () => {
    let server = [task];
    stubApi(async (path, init) => {
      if (path.startsWith("/api/tasks?")) return json(server);
      if (path === `/api/tasks/${task.id}` && init?.method === "DELETE") { server = []; return new Response(null, { status: 204 }); }
      return json({}, 404);
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), remove: useDeleteTask() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([task]));
    await act(async () => { await result.current.remove.mutateAsync({ task }); });
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(result.current.tasks.data).toEqual([]);
  });

  it("refetches only when the last task change settles, counting edits and completions", async () => {
    const a = task;
    const b: Task = { ...task, id: "01JB0000000000000000000002", title: "Feed the cat", position: "a1" };
    const renamed = { ...a, title: "Water the ferns" };
    let server = [a, b];
    let gets = 0;
    const pending: Record<string, (res: Response) => void> = {};
    stubApi((path) => {
      if (path.startsWith("/api/tasks?")) { gets++; return Promise.resolve(json(server)); }
      const m = path.match(/^\/api\/tasks\/(\w+)(\/complete)?$/);
      if (m) return new Promise<Response>((resolve) => { pending[m[1]!] = resolve; });
      return Promise.resolve(json({}, 404));
    });
    const { wrapper } = signedIn();
    const { result } = renderHook(() => ({ tasks: useTasks("view=next"), update: useUpdateTask(), complete: useSetCompleted() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toEqual([a, b]));
    const before = gets;

    act(() => result.current.update.mutate({ id: a.id, patch: { title: renamed.title } }));
    act(() => result.current.complete.mutate({ task: b, done: true }));
    await waitFor(() => expect(result.current.tasks.data).toEqual([renamed]));
    await waitFor(() => expect(Object.keys(pending)).toHaveLength(2));

    // The completion finishes first: the edit is still running, so no refetch.
    server = [a];
    act(() => pending[b.id]!(json({ ...b, completedAt: at, subtasks: 0 })));
    await waitFor(() => expect(result.current.complete.isSuccess).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gets).toBe(before);
    expect(result.current.tasks.data).toEqual([renamed]);

    // The edit finishes last and refetches.
    server = [renamed];
    act(() => pending[a.id]!(json(renamed)));
    await waitFor(() => expect(gets).toBe(before + 1));
    expect(result.current.tasks.data).toEqual([renamed]);
  });
});
