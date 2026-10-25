// worker/src/mcp/response.ts

/**
 * Read an API response for a tool. A non-JSON body (an HTML error page from the
 * edge, say) never reaches Claude: it becomes a failure with no JSON, and a
 * "successful" non-JSON body is treated as a failure too.
 */
export async function parseApiResponse(res: Response): Promise<{ ok: boolean; status: number; json: unknown }> {
  const raw = await res.text();
  if (!raw) return { ok: res.ok, status: res.status, json: undefined };
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(raw) };
  } catch {
    return { ok: false, status: res.status, json: undefined };
  }
}
