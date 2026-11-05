import { CountsSchema, FilterSchema, FolderSchema, LabelSchema, ListSchema, TaskCompletionSchema, TaskSchema, type Label, type LabelColour, type List, type Task } from "@claudia/shared";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { keepPreviousData, useMutation, useMutationState, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { DEFAULT_TIME_ZONE } from "../lib/dates";
import { listPosition, type ListMove } from "../lib/listMove";
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
/** Open-task counts per list, for the sidebar. Not under ["tasks"]: those entries are all task lists. */
export const useCounts = () => useGet(["counts"], "/api/counts", CountsSchema);

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
      const found = cachedTask(queryClient, id);
      return found && [found];
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

/** A task as any cached list or panel entry has it now, or undefined. */
export function cachedTask(queryClient: QueryClient, id: string): Task | undefined {
  for (const [, tasks] of queryClient.getQueriesData<Task[]>(tasksKey)) {
    const found = tasks?.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Refetches the task lists once the last running task change settles, without holding up its result. */
function refetchWhenLast(queryClient: QueryClient) {
  if (queryClient.isMutating({ mutationKey: ["tasks"] }) !== 1) return;
  void queryClient.invalidateQueries(tasksKey);
  void queryClient.invalidateQueries({ queryKey: ["counts"] });
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
      if (saved.completedAt) {
        for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey))
          if (tasks?.some((t) => t.id === saved.id))
            queryClient.setQueryData<Task[]>(key, keepsCompleted(key) ? tasks.map(stamped) : tasks.filter((t) => t.id !== saved.id));
      } else writeCached(queryClient, saved); // A repeating task stays open, with its next date.
    },
    onSettled: () => refetchWhenLast(queryClient),
  });
}

/** The task fields a create or update can set. `null` clears; `labels` replaces the set. */
export type TaskPatch = Partial<
  Pick<Task, "title" | "notes" | "dueDate" | "dueAt" | "startDate" | "snoozedUntil" | "recurRule" | "recurFrom" | "priority" | "labels" | "metadata">
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
    // So its panel opens at once, before the lists are refetched.
    onSuccess: (saved) => queryClient.setQueryData(["tasks", "one", saved.id], [saved]),
    onSettled: (_saved, _error, task) => {
      if (task.labels?.length) void queryClient.invalidateQueries({ queryKey: ["labels"] });
      refetchWhenLast(queryClient);
    },
  });
}

const updateKey = taskWriteKey("update");

/** Whether another change (of the kind `key` names) to the same task is still running besides this one. */
const updatingAgain = (queryClient: QueryClient, id: string, key: QueryKey = updateKey) =>
  queryClient.isMutating({
    mutationKey: key,
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

export interface TaskMove {
  id: string;
  listId?: string;
  parentId?: string | null;
  afterId?: string;
  beforeId?: string;
  /** For a heading: its section (the top-level tasks down to the next heading) moves straight after it. */
  withSection?: boolean;
}

const byPosition = (a: Task, b: Task) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** The list a cached task list is for (its `listId` query), or null for views, filters and the panel. */
const listOfKey = (key: QueryKey) => (typeof key[1] === "string" ? new URLSearchParams(key[1]).get("listId") : null);

/**
 * Where a move puts its tasks, worked out over every cached copy, as the server does it: the task (and with
 * `withSection` its section, in order) gets a list, a parent and a position between its new neighbours, and its
 * subtasks follow it to another list. Null when the task isn't cached, or the neighbours aren't.
 */
function movedInCache(queryClient: QueryClient, { id, ...to }: TaskMove): Map<string, Partial<Task>> | null {
  const all = new Map<string, Task>();
  for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey))
    if (!isOne(key)) for (const t of tasks ?? []) all.set(t.id, t);
  const task = all.get(id);
  if (!task) return null;
  const tasks = [...all.values()];
  const listId = to.listId ?? task.listId;
  // Changing list without naming a parent puts the task at the top level there.
  const parentId = to.parentId !== undefined ? to.parentId : listId === task.listId ? task.parentId : null;

  // A heading's section: the top-level tasks after it, down to the next heading.
  const topLevel = tasks.filter((t) => t.listId === task.listId && t.parentId === null).sort(byPosition);
  const section: Task[] = [];
  if (to.withSection)
    for (const t of topLevel.slice(topLevel.findIndex((t) => t.id === id) + 1)) {
      if (t.kind === "heading") break;
      section.push(t);
    }
  const moving = new Set([id, ...section.map((t) => t.id)]);

  const siblings = tasks.filter((t) => t.listId === listId && t.parentId === parentId && !moving.has(t.id)).sort(byPosition);
  const anchor = to.afterId ?? to.beforeId;
  const at = anchor ? siblings.findIndex((t) => t.id === anchor) : siblings.length;
  if (at < 0) return null;
  const [low, high] = to.afterId ? [siblings[at], siblings[at + 1]] : [siblings[at - 1], siblings[at]];
  const position = generateKeyBetween(low?.position ?? null, high?.position ?? null);
  const positions = generateNKeysBetween(position, high?.position ?? null, section.length);

  const out = new Map<string, Partial<Task>>([[id, { listId, parentId, position }]]);
  section.forEach((t, i) => out.set(t.id, { listId, position: positions[i]! }));
  if (listId !== task.listId)
    for (const top of moving) for (const sub of withSubtasks(tasks, top)) if (!out.has(sub)) out.set(sub, { listId });
  return out;
}

const moveKey = taskWriteKey("move");
const moveListKey = ["lists", "move"];

/**
 * Moves a task (and its subtasks) to another list or parent, or reorders it; with `withSection`, a heading takes its
 * section along. Changing list without a parent puts it at the top level there, and omitting the placement puts it
 * last. It moves in every cached list at once (leaving lists for another list); on failure those tasks are put back.
 * While a later move of the same task is running, an earlier one's answer leaves it where it is shown.
 */
export function useMoveTask() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: moveKey,
    // One at a time, in order: holding Alt+↓ or quick drags mustn't reach the server out of order.
    scope: { id: "task-move" },
    mutationFn: async ({ id, ...to }: TaskMove) => json(await api(`/api/tasks/${id}/move`, send("POST", to)), TaskSchema),
    onMutate: async (move) => {
      await queryClient.cancelQueries(tasksKey);
      const moved = movedInCache(queryClient, move);
      if (!moved) return { changed: [] };
      const target = moved.get(move.id)!.listId;
      return {
        changed: changeCached(queryClient, (tasks) => new Set(tasks.filter((t) => moved.has(t.id)).map((t) => t.id)), (t, key) => {
          if (isOne(key)) return t;
          const list = listOfKey(key);
          return list && list !== target ? null : { ...t, ...moved.get(t.id) };
        }),
      };
    },
    onError: (_error, { id }, context) => {
      if (!updatingAgain(queryClient, id, moveKey)) restoreCached(queryClient, context?.changed);
    },
    // Where it now sits is shown in any list that has it (such as the detail panel's) until the refetch sorts the rest.
    onSuccess: (saved) => {
      if (!updatingAgain(queryClient, saved.id, moveKey)) writeCached(queryClient, saved);
    },
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

/**
 * Deletes a task made with `n t` or `n s` if it's still as `made`, with nothing added under it. Anything unsure keeps
 * the task: a change still saving, or the server not answering. The server has the last word, because deleting takes
 * subtasks too and the cache may not have caught up.
 */
export function useDiscardUntouched() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const remove = useDeleteTask();
  return async (made: Task) => {
    const saving = queryClient.isMutating({
      predicate: (m) => {
        const v = m.state.variables as { id?: string; parentId?: string | null } | undefined;
        return v?.id === made.id || v?.parentId === made.id;
      },
    });
    if (saving > 0) return;
    try {
      const [task, subtasks] = await Promise.all([
        json(await api(`/api/tasks/${made.id}`), TaskSchema),
        json(await api(`/api/tasks?parentId=${made.id}&status=all&limit=1`), TasksSchema),
      ]);
      if (task.updatedAt === made.updatedAt && task.title === made.title && subtasks.length === 0) await remove.mutateAsync({ task });
    } catch { /* it stays, as an ordinary task */ }
  };
}

/**
 * Moves a list in the sidebar (to another folder, or among its siblings), in the cache at once; on failure it goes back
 * and the promise rejects. Moves run one at a time, in order, and the lists are refetched after the last.
 */
export function useMoveList() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: moveListKey,
    scope: { id: "list-move" },
    mutationFn: async ({ id, ...to }: ListMove & { id: string }) => json(await api(`/api/lists/${id}/move`, send("POST", to)), ListSchema),
    onMutate: async ({ id, ...to }) => {
      await queryClient.cancelQueries({ queryKey: ["lists"] });
      const before = queryClient.getQueryData<List[]>(["lists"]);
      const position = before ? listPosition(before, id, to) : null;
      if (position) queryClient.setQueryData<List[]>(["lists"], before?.map((l) => (l.id === id ? { ...l, folderId: to.folderId, position } : l)));
      return { before };
    },
    onError: (_e, _vars, context) => {
      if (context?.before) queryClient.setQueryData(["lists"], context.before);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: moveListKey }) <= 1) void queryClient.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

/**
 * Renames a list or folder, in the cache at once; on failure the old name comes back and the promise rejects.
 * Lists and folders are refetched afterwards.
 */
export function useRename(kind: "lists" | "folders") {
  const { api } = useSession();
  const queryClient = useQueryClient();
  // Only the name matters here: the refetch brings the rest.
  const schema: { parse(data: unknown): { id: string; name: string } } = kind === "lists" ? ListSchema : FolderSchema;
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => json(await api(`/api/${kind}/${id}`, send("PATCH", { name })), schema),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: [kind] });
      const before = queryClient.getQueryData<{ id: string; name: string }[]>([kind]);
      queryClient.setQueryData<{ id: string; name: string }[]>([kind], (items) => items?.map((x) => (x.id === id ? { ...x, name } : x)));
      return { before };
    },
    onError: (_e, _vars, context) => {
      if (context?.before) queryClient.setQueryData([kind], context.before);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: [kind] }),
  });
}

type LabelChange = { name?: string; color?: LabelColour | null };

/**
 * Creating, renaming, recolouring and deleting labels. A rename or delete changes the names tasks carry, so task lists
 * and counts refetch afterwards. Changes show at once in the labels list and come back on failure.
 */
export function useLabelChanges() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const optimistic = async (change: (labels: Label[]) => Label[]) => {
    await queryClient.cancelQueries({ queryKey: ["labels"] });
    const before = queryClient.getQueryData<Label[]>(["labels"]);
    queryClient.setQueryData<Label[]>(["labels"], (labels) => labels && change(labels));
    return { before };
  };
  const restore = (_e: unknown, _vars: unknown, context?: { before?: Label[] }) => {
    if (context?.before) queryClient.setQueryData(["labels"], context.before);
  };
  const refresh = (tasksToo: boolean) => () => {
    void queryClient.invalidateQueries({ queryKey: ["labels"] });
    if (tasksToo) {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["counts"] });
    }
  };
  const create = useMutation({
    mutationFn: async (body: { name: string; color?: LabelColour | null }) => json(await api("/api/labels", send("POST", body)), LabelSchema),
    onSettled: refresh(false),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...change }: LabelChange & { id: string }) => json(await api(`/api/labels/${id}`, send("PATCH", change)), LabelSchema),
    onMutate: ({ id, ...change }) => optimistic((labels) => labels.map((l) => (l.id === id ? { ...l, ...change } : l))),
    onError: restore,
    onSettled: (_d, _e, vars) => refresh(vars.name !== undefined)(),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => json(await api(`/api/labels/${id}`, { method: "DELETE" }), NoContent),
    onMutate: (id) => optimistic((labels) => labels.filter((l) => l.id !== id)),
    onError: restore,
    onSettled: refresh(true),
  });
  return { create, update, remove };
}
