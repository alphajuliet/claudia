// worker/src/mcp/handler.ts
import { createMcpHandler } from "agents/mcp/server";
import { internalHeaders } from "../lib/internal";
import type { Scope } from "../lib/router";
import { parseApiResponse } from "./response";
import { buildServer, type CallApi } from "./server";

export type McpIdentity =
  | { kind: "apitoken"; secret: string; scopes: Scope[] } // forward the caller's own token
  | { kind: "oauth"; scopes: Scope[] }; // call in-process with the internal key

/**
 * Serve MCP for an authenticated caller (the OAuth provider has already checked
 * the bearer). Tools call the app itself: with the caller's own API token, or
 * in-process for an OAuth grant, so the API's rules and scopes apply unchanged.
 */
export async function handleMcp(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  app: { fetch: (req: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Response | Promise<Response> },
  identity: McpIdentity,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const callApi: CallApi = async ({ method, path, query, body }) => {
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const res = await app.fetch(
      new Request(url, {
        method,
        // Never forward the incoming request's headers: X-Claudia-* from a client must not reach the app.
        headers: {
          ...(identity.kind === "apitoken" ? { Authorization: `Bearer ${identity.secret}`, "X-Claudia-Client": "mcp" } : internalHeaders(identity.scopes)),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    );
    return parseApiResponse(res);
  };

  return createMcpHandler(() => buildServer(identity.scopes, callApi), {
    route: "/mcp",
    allowedHostnames: ["claudia.alphajuliet.com", "localhost", "127.0.0.1"],
  })(request, env, ctx);
}
