import { MeSchema, type Me } from "@claudia/shared";

export class ApiUnauthorized extends Error {}
export class ApiNetworkError extends Error {}

/** fetch with the token and client headers. 401 and network failures become typed errors. */
export async function apiFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, "X-Claudia-Client": "web" },
    });
  } catch {
    throw new ApiNetworkError("Can't reach Claudia");
  }
  if (res.status === 401) throw new ApiUnauthorized("Token rejected");
  return res;
}

export async function fetchMe(token: string): Promise<Me> {
  const res = await apiFetch(token, "/api/me");
  if (!res.ok) throw new Error(`Unexpected response (${res.status})`);
  return MeSchema.parse(await res.json());
}
