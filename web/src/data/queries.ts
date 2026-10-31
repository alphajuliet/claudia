import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
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

export const useFilterTasks = (id: string) => useGet(["tasks", "filter", id], `/api/filters/${id}/tasks`, TasksSchema);

/** Completes or reopens a task, updating every cached task list at once and rolling back on failure. */
export function useSetCompleted() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const tasksKey = { queryKey: ["tasks"] };
  return useMutation({
    mutationFn: async ({ task, done }: { task: Task; done: boolean }) =>
      json(await api(`/api/tasks/${task.id}/${done ? "complete" : "uncomplete"}`, { method: "POST" }), TaskSchema),
    onMutate: async ({ task, done }) => {
      await queryClient.cancelQueries(tasksKey);
      const snapshots = queryClient.getQueriesData<Task[]>(tasksKey);
      // A repeating task stays: it comes back open with its next due date.
      if (done && !task.recurRule) queryClient.setQueriesData<Task[]>(tasksKey, (tasks) => tasks?.filter((t) => t.id !== task.id));
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (saved) => {
      queryClient.setQueriesData<Task[]>(tasksKey, (tasks) =>
        saved.completedAt ? tasks?.filter((t) => t.id !== saved.id) : tasks?.map((t) => (t.id === saved.id ? saved : t)),
      );
    },
    onSettled: () => queryClient.invalidateQueries(tasksKey),
  });
}
