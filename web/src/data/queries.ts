import { useMutation, useMutationState, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { FilterSchema, FolderSchema, ListSchema, TaskSchema, type Task } from "@claudia/shared";
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

/** The user's time zone setting, or the default until it loads. */
export function useTimeZone(): string {
  const { data } = useGet(["settings"], "/api/settings", SettingsSchema);
  const timeZone = data?.timeZone;
  return typeof timeZone === "string" && timeZone ? timeZone : DEFAULT_TIME_ZONE;
}

/** Tasks matching a query string (without the "?"). Null waits. */
export const useTasks = (query: string | null) => useGet(["tasks", query], query === null ? null : `/api/tasks?${query}`, TasksSchema);

export const useFilterTasks = (id: string) => useGet(["tasks", "filter", id], `/api/filters/${id}/tasks?limit=500`, TasksSchema);

const setCompletedKey = ["setCompleted"];
interface SetCompletedVars { task: Task; done: boolean }

/** Ids of tasks with a complete or reopen still running. */
export function usePendingCompletions(): Set<string> {
  const ids = useMutationState({
    filters: { mutationKey: setCompletedKey, status: "pending" },
    select: (m) => (m.state.variables as SetCompletedVars).task.id,
  });
  return new Set(ids);
}

/**
 * Completes or reopens a task, updating every cached task list at once. On failure only that task is put back,
 * so others completed meanwhile stay gone. Lists are refetched once the last running change settles.
 */
export function useSetCompleted() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const tasksKey = { queryKey: ["tasks"] };
  return useMutation({
    mutationKey: setCompletedKey,
    mutationFn: async ({ task, done }: SetCompletedVars) =>
      json(await api(`/api/tasks/${task.id}/${done ? "complete" : "uncomplete"}`, { method: "POST" }), TaskSchema),
    onMutate: async ({ task, done }) => {
      await queryClient.cancelQueries(tasksKey);
      // A repeating task stays: it comes back open with its next due date.
      if (!done || task.recurRule) return { removedFrom: [] };
      const removedFrom: { key: QueryKey; index: number }[] = [];
      for (const [key, tasks] of queryClient.getQueriesData<Task[]>(tasksKey)) {
        const index = tasks?.findIndex((t) => t.id === task.id) ?? -1;
        if (index < 0) continue;
        removedFrom.push({ key, index });
        queryClient.setQueryData<Task[]>(key, tasks!.filter((t) => t.id !== task.id));
      }
      return { removedFrom };
    },
    onError: (_error, { task }, context) => {
      // Back where it was, near enough: the refetch puts everything in order.
      for (const { key, index } of context?.removedFrom ?? [])
        queryClient.setQueryData<Task[]>(key, (tasks) =>
          !tasks || tasks.some((t) => t.id === task.id) ? tasks : [...tasks.slice(0, index), task, ...tasks.slice(index)]);
    },
    onSuccess: (saved) => {
      queryClient.setQueriesData<Task[]>(tasksKey, (tasks) =>
        saved.completedAt ? tasks?.filter((t) => t.id !== saved.id) : tasks?.map((t) => (t.id === saved.id ? saved : t)),
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: setCompletedKey }) === 1) return queryClient.invalidateQueries(tasksKey);
    },
  });
}
