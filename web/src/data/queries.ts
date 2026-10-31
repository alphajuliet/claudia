import { FilterSchema, FolderSchema, LabelSchema, ListSchema, TaskCompletionSchema, TaskSchema, type Task } from "@claudia/shared";
import { useMutation, useMutationState, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { DEFAULT_TIME_ZONE } from "../lib/dates";
import { useSession } from "../session/SessionProvider";

/** Parses a response with a schema, or throws the API's error message. */
export async function json<T>(res: Response, schema: { parse(data: unknown): T }): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new Error(typeof message === "string" && message ? message : `Unexpected response (${res.status})`);
  }
  return schema.parse(body);
}

const TasksSchema = TaskSchema.array();
const NoContent = { parse: () => undefined };
const SettingsSchema = { parse: (data: unknown) => (data ?? {}) as Record<string, unknown> };

/** A GET that waits for sign-in, because `api()` throws when signed out. */
function useGet<T>(key: QueryKey, path: string | null, schema: { parse(data: unknown): T }) {
  const { state, api } = useSession();
  return useQuery({
    queryKey: key,
    queryFn: async () => json(await api(path!), schema),
    enabled: state.status === "signedIn" && path !== null,
  });
}

export const useFolders = () => useGet(["folders"], "/api/folders", FolderSchema.array());
export const useLists = () => useGet(["lists"], "/api/lists", ListSchema.array());
export const useFilters = () => useGet(["filters"], "/api/filters", FilterSchema.array());
export const useLabels = () => useGet(["labels"], "/api/labels", LabelSchema.array());

/** The user's time zone setting, or the default until it loads. */
export function useTimeZone(): string {
  const { data } = useGet(["settings"], "/api/settings", SettingsSchema);
  const timeZone = data?.timeZone;
  return typeof timeZone === "string" && timeZone ? timeZone : DEFAULT_TIME_ZONE;
}

/** Tasks matching a query string (without the "?"). Null waits. */
export const useTasks = (query: string | null) => useGet(["tasks", query], query === null ? null : `/api/tasks?${query}`, TasksSchema);

export const useFilterTasks = (id: string) => useGet(["tasks", "filter", id], `/api/filters/${id}/tasks?limit=500`, TasksSchema);

/** A JSON request body. */
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Every task change has a key under this prefix, so the last one running can tell. */
const taskWriteKey = (kind: string) => ["tasks", kind];
const tasksKey = { queryKey: ["tasks"] };

/** Refetches the task lists once the last running task change settles, without holding up its result. */
function refetchWhenLast(queryClient: QueryClient) {
  if (queryClient.isMutating({ mutationKey: ["tasks"] }) === 1) void queryClient.invalidateQueries(tasksKey);
}

/** Tasks changed or removed in one cached list, with where they were, so a failure can put back just those. */
type Changed = { key: QueryKey; before: { task: Task; index: number; removed: boolean }[] }[];

/**
 * In every cached task list, replaces the tasks picked by `pick` with `change(task)`, or removes them where it gives
 * null. Returns what they were.
 */
function changeCached(
  queryClient: QueryClient,
  pick: (tasks: Task[]) => Set<string>,
  change: (task: Task) => Task | null,
): Changed {
  const changed: Changed = [];
  for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey)) {
    if (!tasks) continue;
    const ids = pick(tasks);
    const before: Changed[number]["before"] = [];
    const after = tasks.flatMap((task, index) => {
      if (!ids.has(task.id)) return [task];
      const next = change(task);
      before.push({ task, index, removed: next === null });
      return next ? [next] : [];
    });
    if (!before.length) continue;
    changed.push({ key, before });
    queryClient.setQueryData<Task[]>(key, after);
  }
  return changed;
}

/** Puts back what `changeCached` changed. Others' changes meanwhile stay; the refetch puts everything in order. */
function restoreCached(queryClient: QueryClient, changed: Changed | undefined) {
  for (const { key, before } of changed ?? [])
    queryClient.setQueryData<Task[]>(key, (tasks) => {
      if (!tasks) return tasks;
      const out = [...tasks];
      for (const { task, index, removed } of before) {
        const at = out.findIndex((t) => t.id === task.id);
        if (at >= 0) out[at] = task;
        else if (removed) out.splice(index, 0, task);
      }
      return out;
    });
}

/** Writes a task the server returned into every cached list that has it. */
function writeCached(queryClient: QueryClient, saved: Task) {
  queryClient.setQueriesData<Task[]>(tasksKey, (tasks) => tasks?.map((t) => (t.id === saved.id ? saved : t)));
}

const setCompletedKey = taskWriteKey("setCompleted");
interface SetCompletedVars { task: Task; done: boolean }

/** Ids of tasks with a complete or reopen still running. */
export function usePendingCompletions(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: setCompletedKey, status: "pending" },
    select: (m) => (m.state.variables as SetCompletedVars).task.id,
  });
  return new Set(ids);
}

/** A task and its subtasks at every level among `tasks`. */
function withSubtasks(tasks: Task[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of tasks) if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
  }
  return ids;
}

/**
 * Completes or reopens a task, updating every cached task list at once. Completing a plain task takes its subtasks
 * with it, as the server does. On failure only those tasks are put back, so others completed meanwhile stay gone.
 * Lists are refetched once the last running task change settles.
 */
export function useSetCompleted() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: setCompletedKey,
    mutationFn: async ({ task, done }: SetCompletedVars) =>
      json(await api(`/api/tasks/${task.id}/${done ? "complete" : "uncomplete"}`, { method: "POST" }), TaskCompletionSchema),
    onMutate: async ({ task, done }) => {
      await queryClient.cancelQueries(tasksKey);
      // A repeating task stays: it comes back open with its next due date.
      if (!done || task.recurRule) return { changed: [] };
      return { changed: changeCached(queryClient, (tasks) => withSubtasks(tasks, task.id), () => null) };
    },
    onError: (_error, _vars, context) => restoreCached(queryClient, context?.changed),
    onSuccess: ({ subtasks: _subtasks, ...saved }) => {
      if (saved.completedAt) queryClient.setQueriesData<Task[]>(tasksKey, (tasks) => tasks?.filter((t) => t.id !== saved.id));
      else writeCached(queryClient, saved);
    },
    onSettled: () => refetchWhenLast(queryClient),
  });
}

/** The task fields a create or update can set. `null` clears; `labels` replaces the set. */
export type TaskPatch = Partial<
  Pick<Task, "title" | "notes" | "dueDate" | "dueAt" | "startDate" | "snoozedUntil" | "recurRule" | "recurFrom" | "labels" | "metadata">
>;

export interface TaskCreate extends TaskPatch {
  listId: string;
  title: string;
  parentId?: string | null;
  kind?: Task["kind"];
  afterId?: string;
  beforeId?: string;
}

/**
 * Creates a task (appended unless `afterId` or `beforeId` is given). Which cached lists it belongs in is the server's
 * call, so they are refetched rather than updated at once.
 */
export function useCreateTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("create"),
    mutationFn: async (task: TaskCreate) => json(await api("/api/tasks", send("POST", task)), TaskSchema),
    onSettled: (_saved, _error, task) => {
      if (task.labels?.length) void queryClient.invalidateQueries({ queryKey: ["labels"] });
      refetchWhenLast(queryClient);
    },
  });
}

/** Changes a task's fields, in every cached list at once. On failure only that task is put back. */
export function useUpdateTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("update"),
    mutationFn: async ({ id, patch }: { id: string; patch: TaskPatch }) =>
      json(await api(`/api/tasks/${id}`, send("PATCH", patch)), TaskSchema),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries(tasksKey);
      return { changed: changeCached(queryClient, () => new Set([id]), (task) => ({ ...task, ...patch })) };
    },
    onError: (_error, _vars, context) => restoreCached(queryClient, context?.changed),
    onSuccess: (saved) => writeCached(queryClient, saved),
    onSettled: (_saved, _error, { patch }) => {
      if (patch.labels) void queryClient.invalidateQueries({ queryKey: ["labels"] });
      refetchWhenLast(queryClient);
    },
  });
}

export interface TaskMove { id: string; listId?: string; parentId?: string | null; afterId?: string; beforeId?: string }

/** Moves a task (and its subtasks) to another list or parent, or reorders it. Lists are refetched, not changed at once. */
export function useMoveTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("move"),
    mutationFn: async ({ id, ...to }: TaskMove) => json(await api(`/api/tasks/${id}/move`, send("POST", to)), TaskSchema),
    onSettled: () => refetchWhenLast(queryClient),
  });
}

/** Deletes a task and its subtasks, taking them out of every cached list at once. On failure they are put back. */
export function useDeleteTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("delete"),
    mutationFn: async ({ task }: { task: Task }) => json(await api(`/api/tasks/${task.id}`, { method: "DELETE" }), NoContent),
    onMutate: async ({ task }) => {
      await queryClient.cancelQueries(tasksKey);
      return { changed: changeCached(queryClient, (tasks) => withSubtasks(tasks, task.id), () => null) };
    },
    onError: (_error, _vars, context) => restoreCached(queryClient, context?.changed),
    onSettled: () => refetchWhenLast(queryClient),
  });
}
