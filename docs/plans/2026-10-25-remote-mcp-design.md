# Remote MCP server: design

Date: 2026-10-25. Status: approved, not yet built.

## Goal

Let Claude read and change tasks from every surface (claude.ai, Claude Desktop, mobile and Claude Code) through a remote MCP server at `https://claudia.alphajuliet.com/mcp`, including the update and move operations Godspeed's API lacked.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Server runtime | `createMcpHandler` (stateless Streamable HTTP) from the Agents SDK | Cloudflare now deprecates `McpAgent` for new servers. A stateless handler needs no Durable Object, and all state is already in D1. This supersedes the earlier "McpAgent" plan. |
| Consent login | Cloudflare Access passkey in front of `/authorize` only | One identity story for the web app and MCP, with no passwords. |
| Claude's powers | Read and write; no delete tools | An assistant acting from chat should not be able to remove anything. Deletes happen in the app. |
| Tool implementation | Tools call a private in-process copy of the Hono app | Reuses validation, event logging, ordering and soft deletes. No second code path to keep in step. |
| Transport | Streamable HTTP only | SSE is deprecated. |

## Routing and access

The Worker's entry point becomes `OAuthProvider` from `@cloudflare/workers-oauth-provider`.

| Path | Handled by | Who can call it |
|---|---|---|
| `/mcp` | `createMcpHandler` via the provider's `apiHandler` | OAuth access tokens issued to a Claude client |
| `/authorize` | Our consent page (the provider's `defaultHandler`) | Behind Cloudflare Access; the Worker validates the Access JWT |
| `/token`, `/register`, `/.well-known/*` | The provider | Public; they issue nothing without a valid code and PKCE |
| `/api/*` | Existing Hono app | API tokens, and an Access login for the web app |
| everything else | Static web app | Public page; it shows no data |

`wrangler.jsonc` needs `OAUTH_KV` (a KV namespace), the `global_fetch_strictly_public` compatibility flag (for client metadata documents), and `/authorize`, `/token`, `/register` and `/.well-known/*` added to `assets.run_worker_first`.

## Connecting a client

1. Claude calls `/mcp` and receives a 401 pointing to the discovery documents.
2. It registers itself (Dynamic Client Registration or a client metadata document).
3. It opens `/authorize` in the browser. Access asks for the passkey.
4. The consent page shows the client's name and the host it returns to. Allow completes the grant; Deny returns `access_denied`.
5. Claude exchanges the code (with PKCE) for an access token and a rotating refresh token.

The grant carries the user's identity and the scope `tasks:read tasks:write`. An expired access token returns 401 and the client refreshes silently. Anyone can register a client, but nobody can authorise one without the Access login. Claude's OAuth callback is `https://claude.ai/api/mcp/auth_callback` (it may become `claude.com`); Claude Code uses a loopback address.

## Tools

24 tools, named verb_noun, each a thin wrapper over one API route.

| Group | Tools |
|---|---|
| Read | `search_tasks`, `get_task`, `run_filter`, `list_folders`, `list_lists`, `list_labels`, `list_filters` |
| Tasks | `create_task`, `update_task`, `move_task`, `complete_task`, `uncomplete_task` |
| Lists and folders | `create_list`, `update_list`, `move_list`, `create_folder`, `update_folder`, `move_folder` |
| Labels and filters | `create_label`, `rename_label`, `create_filter`, `update_filter` |

Not exposed: every delete, tokens, settings and import.

- **Inputs** are the shared Zod schemas, so an API rule change reaches the tools. Descriptions teach conventions: dates are `YYYY-MM-DD`, labels are state, update and move are separate steps.
- **Results** are compact JSON. `search_tasks` returns at most 50 by default, with `offset`.
- **Errors** from the API become tool errors carrying the message, so Claude can correct its request.
- **Annotations** mark read tools as read-only, so clients can auto-approve them.
- **Identity:** tools call a private copy of the app, built inside the Worker and unreachable from outside, with a trusted `mcp` identity and the `write` scope. It cannot reach tokens or import. Events are logged with actor `mcp`.

## Testing

- Unit tests: argument-to-request mapping for each tool; API errors become tool errors.
- A test that the tool list contains no delete, token, settings or import tools.
- An integration test in workerd with a fake Access JWT check: register, authorise, token, `tools/list`, `create_task`. It also checks that an unauthenticated call is refused and that the event actor is `mcp`.
- By hand (needs Andrew): connect Claude Code (`claude mcp add --transport http …`) and the claude.ai connector.

## Order of work

1. **Cloudflare Access** (existing BACKLOG card): an Access application for the site, Access JWT validation in the Worker, and the web app's `/api` sign-in. This gives the consent page its login.
2. **MCP tools and handler**, first behind the existing API tokens so Claude Code can use it straight away with a bearer header.
3. **OAuth wrapper, consent page and KV**, so claude.ai and the phone can connect.

## Out of scope

MCP prompts and resources, SSE, per-connection read-only mode, a screen to list and revoke connected clients (revoke by deleting the grant in KV until then), and any delete tool.

## Open items to check while building

- The OAuth library's default token lifetimes and the exact option names (`parseAuthRequest`, `completeAuthorization`); the README did not give them.
- Whether a client that reaches `/mcp` with a Claudia API token can be accepted alongside OAuth tokens, or whether static-token access should be a separate path.
- claude.ai has been reported to need a `WWW-Authenticate` header on the 401; confirm it is sent.
