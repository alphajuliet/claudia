# Web app sign-in: design

Date: 2026-10-26. Status: built.

Cloudflare Access was dropped (see the 2026-10-25 `#Decision` in the Obsidian note). The web app signs in with an API token instead: it asks for one, checks it, and keeps it in the browser. The page itself is public and shows nothing without a token.

This card delivers the sign-in gate only. Task views, token management screens and an idle timeout are separate work.

## API: `GET /api/me`

- Any valid token can call it (read scope is enough, so every token works).
- Returns `{ name, scopes, expiresAt }` for the token making the call. Never the secret.
- The token's `name` and `expiresAt` are put on the request context by `authenticate`, next to `scopes`.
- An in-process MCP call has no stored token, so it reports the name "MCP connection" with no expiry. The web app never uses that path.
- Errors are the usual ones: 401 for a missing, unknown, revoked or expired token.

## Web app

State machine, owned by a `SessionProvider`:

| State | Meaning | Shows |
|-------|---------|-------|
| `loading` | A stored token is being checked | "Checking…" |
| `signedOut` | No token, or it was rejected | Sign-in form, with a notice if it was rejected |
| `offline` | The check could not reach the server | "Can't reach Claudia" and Try again (the token is kept) |
| `signedIn` | `/api/me` accepted the token | The signed-in shell |

- The token lives in `localStorage` under `claudia.token`. Reads and writes are wrapped in try/catch; if storage is blocked the session still works until the tab closes.
- A pasted token is checked with `/api/me` before it is stored. A bad paste is never saved.
- A 401 on load clears the token and shows "That token isn't valid or has expired." A network failure never signs you out.
- Any later 401 from any call made through the session's `api()` signs out the same way, so a revoked token cannot leave a half-working app.
- Sign out clears the token and the React Query cache.

An `api` module attaches `Authorization: Bearer …` and `X-Claudia-Client: web` to every call and is what later UI work uses.

The signed-in shell is a placeholder: heading, "Signed in as {name} ({scopes})", and Sign out.

## Testing

- Worker: API tests for `/api/me` (valid, read-only, revoked, expired, missing, and no secret in the response).
- Web: Vitest with jsdom and Testing Library, covering the sign-in form, a rejected paste, a stored token on load (valid, rejected, offline then retry), a 401 mid-session, and sign out.

## Out of scope

Token management screens, an idle timeout, the real UI, offline capture.
