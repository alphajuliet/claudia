import { FilterSchema, FolderSchema, LabelSchema, ListSchema, TaskCompletionSchema, TaskSchema, type Task } from "@claudia/shared";
import { keepPreviousData, useMutation, useMutationState, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
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
function useGet<T>(key: QueryKey, path: string | null, schema: { parse(data: unknown): T }, opts: { keepPrevious?: boolean } = {}) {
  const { state, api } = useSession();
  return useQuery({
    queryKey: key,
    queryFn: async () => json(await api(path!), schema),
    enabled: state.status === "signedIn" && path !== null,
    ...(opts.keepPrevious ? { placeholderData: keepPreviousData } : {}),
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
export const useTasks = (query: string | null, opts: TaskListOptions = {}) =>
  useGet(listKey(["tasks", query], opts), query === null ? null : `/api/tasks?${query}`, TasksSchema, opts);

/**
 * One task, as a list of none or one so that it sits with the other task lists and every task change (at once, on
 * failure, on refetch) reaches it too. Empty when the task doesn't exist (404). Starts from any cached copy.
 */
export function useTask(id: string) {
  const { state, api } = useSession();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["tasks", "one", id],
    queryFn: async () => {
      const res = await api(`/api/tasks/${id}`);
      return res.status === 404 ? [] : [await json(res, TaskSchema)];
    },
    initialData: () => {
      for (const [, tasks] of queryClient.getQueriesData<Task[]>(tasksKey)) {
        const found = tasks?.find((t) => t.id === id);
        if (found) return [found];
      }
      return undefined;
    },
    // A cached copy shows at once, but is checked with the server.
    initialDataUpdatedAt: 0,
    enabled: state.status === "signedIn",
  });
}

/** A saved filter's tasks; `status` overrides the filter's own (null leaves the query off). */
export const useFilterTasks = (id: string | null, opts: TaskListOptions & { status?: "completed" } = {}) =>
  useGet(
    listKey(["tasks", "filter", id, ...(opts.status ? [opts.status] : [])], opts),
    id === null ? null : `/api/filters/${id}/tasks?limit=500${opts.status ? `&status=${opts.status}` : ""}`,
    TasksSchema,
    opts,
  );

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

/** The detail panel's entry for one task (see `useTask`), as opposed to a list of tasks. */
const isOne = (key: QueryKey) => key[1] === "one";

/**
 * Entries whose tasks stay on screen when completed (the panel's, lists fetched with `status=all`, and open lists
 * shown with their completed tasks), so completing marks rather than removes.
 */
const keepsCompleted = (key: QueryKey) =>
  isOne(key) || key.at(-1) === WITH_COMPLETED || (typeof key[1] === "string" && new URLSearchParams(key[1]).get("status") === "all");

/** Ends the key of a task list shown with its completed tasks (so it is a cache entry of its own). */
const WITH_COMPLETED = "withCompleted";

interface TaskListOptions {
  /** While a changed query loads, keep showing the rows (no "Loading…"). */
  keepPrevious?: boolean;
  /** The screen also shows completed tasks: completing one marks it rather than removing it. */
  keepsCompleted?: boolean;
}

const listKey = (base: QueryKey, opts: TaskListOptions) => (opts.keepsCompleted ? [...base, WITH_COMPLETED] : base);

/**
 * In every cached task list, replaces the tasks picked by `pick` with `change(task, key)`, or removes them where it
 * gives null. Returns what they were.
 */
function changeCached(
  queryClient: QueryClient,
  pick: (tasks: Task[]) => Set<string>,
  change: (task: Task, key: QueryKey) => Task | null,
): Changed {
  const changed: Changed = [];
  for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey)) {
    if (!tasks) continue;
    const ids = pick(tasks);
    const before: Changed[number]["before"] = [];
    const after = tasks.flatMap((task, index) => {
      if (!ids.has(task.id)) return [task];
      const next = change(task, key);
      if (next === task) return [task];
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
      if (task.recurRule) return { changed: [] };
      // Reopening takes the subtasks completed with it (the same moment), as the server does.
      if (!done) {
        const at = task.completedAt;
        if (!at) return { changed: [] };
        const pick = (tasks: Task[]) => new Set([...withSubtasks(tasks, task.id)].filter((id) => tasks.find((t) => t.id === id)?.completedAt === at));
        return { changed: changeCached(queryClient, pick, (t) => ({ ...t, completedAt: null })) };
      }
      // Lists showing completed tasks (and the detail panel, so it can tell completed from deleted) keep them, marked.
      const completedAt = new Date().toISOString();
      // Subtasks already completed keep their own time, as on the server.
      return {
        completedAt,
        changed: changeCached(queryClient, (tasks) => withSubtasks(tasks, task.id), (t, key) =>
          keepsCompleted(key) ? (t.completedAt ? t : { ...t, completedAt }) : null),
      };
    },
    onError: (_error, _vars, context) => restoreCached(queryClient, context?.changed),
    onSuccess: ({ subtasks: _subtasks, ...saved }, _vars, context) => {
      // Subtasks completed with it get the server's time, so reopening (or Undo) finds them before the refetch.
      const stamped = (t: Task) =>
        t.id === saved.id ? saved : context && "completedAt" in context && t.completedAt === context.completedAt ? { ...t, completedAt: saved.completedAt } : t;
      if (saved.completedAt)
        for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey))
          if (tasks?.some((t) => t.id === saved.id))
            queryClient.setQueryData<Task[]>(key, keepsCompleted(key) ? tasks.map(stamped) : tasks.filter((t) => t.id !== saved.id));
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

const updateKey = taskWriteKey("update");

/** Whether another change to the same task is still running besides this one. */
const updatingAgain = (queryClient: QueryClient, id: string) =>
  queryClient.isMutating({
    mutationKey: updateKey,
    predicate: (m) => (m.state.variables as { id?: string } | undefined)?.id === id,
  }) > 1;

/**
 * Changes a task's fields, in every cached list at once. On failure only that task is put back. While a later change
 * to the same task is still running, an earlier one's answer or failure leaves the task as it is shown (the latest
 * change), and the refetch after the last change settles puts it right.
 */
export function useUpdateTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: updateKey,
    mutationFn: async ({ id, patch }: { id: string; patch: TaskPatch }) =>
      json(await api(`/api/tasks/${id}`, send("PATCH", patch)), TaskSchema),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries(tasksKey);
      return { changed: changeCached(queryClient, () => new Set([id]), (task) => ({ ...task, ...patch })) };
    },
    onError: (_error, { id }, context) => {
      if (!updatingAgain(queryClient, id)) restoreCached(queryClient, context?.changed);
    },
    onSuccess: (saved) => {
      if (!updatingAgain(queryClient, saved.id)) writeCached(queryClient, saved);
    },
    onSettled: (_saved, _error, { patch }) => {
      if (patch.labels) void queryClient.invalidateQueries({ queryKey: ["labels"] });
      refetchWhenLast(queryClient);
    },
  });
}

export interface TaskMove { id: string; listId?: string; parentId?: string | null; afterId?: string; beforeId?: string }

/**
 * Moves a task (and its subtasks) to another list or parent, or reorders it. Changing list without a parent puts it at
 * the top level there. Lists are refetched rather than changed at once.
 */
export function useMoveTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("move"),
    mutationFn: async ({ id, ...to }: TaskMove) => json(await api(`/api/tasks/${id}/move`, send("POST", to)), TaskSchema),
    // Where it now sits is shown in any list that has it (such as the detail panel's) until the refetch sorts the rest.
    onSuccess: (saved) => writeCached(queryClient, saved),
    onSettled: () => refetchWhenLast(queryClient),
  });
}

/**
 * Deletes a task and its subtasks, taking them out of every cached list at once (but the detail panel's copy, which
 * the panel closes over). On failure they are put back.
 */
export function useDeleteTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: taskWriteKey("delete"),
    mutationFn: async ({ task }: { task: Task }) => json(await api(`/api/tasks/${task.id}`, { method: "DELETE" }), NoContent),
    onMutate: async ({ task }) => {
      await queryClient.cancelQueries(tasksKey);
      return { changed: changeCached(queryClient, (tasks) => withSubtasks(tasks, task.id), (t, key) => (isOne(key) ? t : null)) };
    },
    onError: (_error, _vars, context) => restoreCached(queryClient, context?.changed),
    onSettled: () => refetchWhenLast(queryClient),
  });
}
