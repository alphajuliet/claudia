// worker/src/mcp/handler.ts
import { createMcpHandler } from "agents/mcp/server";
import { lookupToken } from "../lib/auth";
import { createDb } from "../lib/db";
import type { Scope } from "../lib/router";
import { buildServer, type CallApi } from "./server";

const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: "unauthorized", message: "Missing or invalid token" } }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="claudia"' },
  });

/**
 * Serve MCP for a caller holding a Claudia API token. Tools call the app
 * itself with that same token, so the API's rules and scopes apply unchanged.
 */
export async function handleMcp(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  app: { fetch: (req: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Response | Promise<Response> },
): Promise<Response> {
  const header = request.headers.get("Authorization") ?? "";
  const secret = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = await lookupToken(createDb(env.DB), secret);
  if (!row) return unauthorized();

  const origin = new URL(request.url).origin;
  const callApi: CallApi = async ({ method, path, query, body }) => {
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const res = await app.fetch(
      new Request(url, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          "X-Claudia-Client": "mcp",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    );
    const raw = await res.text();
    return { ok: res.ok, status: res.status, json: raw ? JSON.parse(raw) : undefined };
  };

  return createMcpHandler(() => buildServer(row.scopes as Scope[], callApi), {
    route: "/mcp",
    allowedHostnames: ["claudia.alphajuliet.com", "localhost"],
  })(request, env, ctx);
}
