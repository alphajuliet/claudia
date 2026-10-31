import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { List, Task } from "@claudia/shared";
import { SessionProvider } from "../session/SessionProvider";
import { tokenStore } from "../session/store";
import { useLists, useSetCompleted, useTasks } from "./queries";

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
    act(() => pending[b.id]!(json({ ...b, completedAt: at })));
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
});
