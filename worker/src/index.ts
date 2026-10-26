import { HealthSchema } from "@claudia/shared";
import { createRoute } from "@hono/zod-openapi";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { SCOPES } from "@claudia/shared";
import { authenticate, lookupToken } from "./lib/auth";
import { createDb } from "./lib/db";
import { ApiError } from "./lib/errors";
import { jsonResponse, newRouter, type Scope } from "./lib/router";
import { handleMcp, type McpIdentity } from "./mcp/handler";
import { consentRoutes, OAUTH_SCOPES } from "./oauth/consent";
import { redirectAllowed } from "./oauth/policy";
import { folderRoutes } from "./routes/folders";
import { importRoutes } from "./routes/import";
import { filterRoutes } from "./routes/filters";
import { labelRoutes } from "./routes/labels";
import { listRoutes } from "./routes/lists";
import { meRoutes } from "./routes/me";
import { settingRoutes } from "./routes/settings";
import { taskRoutes } from "./routes/tasks";
import { tokenRoutes } from "./routes/tokens";

export const app = newRouter();

app.use("/api/*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

// Public: liveness and the spec. Everything else under /api needs a token.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/openapi.json") return next();
  return authenticate(c, next);
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, issues: err.issues } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    tags: ["System"],
    responses: { 200: jsonResponse(HealthSchema, "Service is up") },
  }),
  (c) => c.json({ ok: true as const, service: "claudia" as const }, 200),
);

app.route("/", meRoutes);
app.route("/", tokenRoutes);
app.route("/", folderRoutes);
app.route("/", listRoutes);
app.route("/", taskRoutes);
app.route("/", labelRoutes);
app.route("/", filterRoutes);
app.route("/", settingRoutes);
app.route("/", importRoutes);
app.route("/", consentRoutes);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "API token created with POST /api/tokens (prefix cl_)",
});

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { title: "Claudia API", version: "0.1.0" },
  security: [{ bearerAuth: [] }],
});

// Hard-coded to production: local `wrangler dev` needs an OAuth or tokenless test, not a real MCP client flow.
const RESOURCE = "https://claudia.alphajuliet.com/mcp";

/** Keep only scope names we know. OAuth grants get read or write at most, never admin. */
const known = (value: unknown, allowed: readonly string[]): Scope[] =>
  Array.isArray(value) ? ([...new Set(value)].filter((s): s is Scope => typeof s === "string" && allowed.includes(s))) : [];

const OAUTH_TO_SCOPE: Record<string, Scope> = { "tasks:read": "read", "tasks:write": "write" };

/** The grant's static scopes, narrowed to what this particular token carries (a refresh can downscope). */
const oauthScopes = (value: unknown, tokenScope: unknown): Scope[] => {
  const granted = known(value, ["read", "write"]);
  const carried = new Set(Array.isArray(tokenScope) ? tokenScope.map((s) => OAUTH_TO_SCOPE[String(s)]).filter(Boolean) : []);
  const effective = granted.filter((s) => carried.has(s));
  return effective.length ? effective : ["read"];
};

/**
 * The Worker's entry point. The provider owns /mcp, /token, /register and the
 * discovery documents; everything else (the API, the consent page) goes to the app.
 */
export const provider = new OAuthProvider<Cloudflare.Env>({
  apiRoute: "/mcp",
  apiHandler: {
    fetch: (req, env, ctx) => {
      const props = ((ctx as { props?: unknown }).props ?? {}) as { kind?: unknown; scopes?: unknown };
      const auth = (ctx as { auth?: { token?: string; scope?: unknown } }).auth;
      const identity: McpIdentity =
        props.kind === "apitoken" && typeof auth?.token === "string"
          ? { kind: "apitoken", secret: auth.token, scopes: known(props.scopes, SCOPES) }
          : { kind: "oauth", scopes: oauthScopes(props.scopes, auth?.scope) };
      return handleMcp(req, env, ctx, app, identity);
    },
  },
  defaultHandler: { fetch: (req, env, ctx) => app.fetch(req, env, ctx) },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: OAUTH_SCOPES,
  resourceMetadata: { resource: RESOURCE, authorization_servers: ["https://claudia.alphajuliet.com"] },
  clientRegistrationCallback: ({ clientMetadata }) => {
    const uris = clientMetadata.redirect_uris;
    const ok = Array.isArray(uris) && uris.length > 0 && uris.every((u) => typeof u === "string" && redirectAllowed(u));
    return ok ? undefined : { code: "invalid_redirect_uri", description: "Redirect URI not allowed" };
  },
  resolveExternalToken: async ({ token, env }) => {
    const row = await lookupToken(createDb(env.DB), token);
    return row ? { props: { kind: "apitoken", scopes: row.scopes }, audience: RESOURCE } : null;
  },
});

export default provider;
