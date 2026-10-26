# Web Sign-In Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The web app asks for an API token once, checks it against a new `GET /api/me`, keeps it in the browser, and shows a signed-in placeholder shell.

**Architecture:** A small read-only endpoint reports the calling token's name, scopes and expiry. The web app has a `SessionProvider` (state machine: loading, signedOut, offline, signedIn), a token store over `localStorage`, and an `api` helper that adds auth headers and signs out on any 401. Design: `docs/plans/2026-10-26-web-sign-in-design.md`.

**Tech Stack:** Hono and `@hono/zod-openapi` (worker), React 19, TanStack Query, Vitest 4 with jsdom and Testing Library (web).

---

Conventions: Australian English in UI copy. Small commits with imperative messages ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Run commands from the repo root. Never print or commit tokens.

### Task 1: `GET /api/me`

**Files:**
- Modify: `shared/src/schemas.ts` (add `MeSchema` after the Tokens section, before the `export type` lines)
- Modify: `worker/src/lib/router.ts:11` (add `identity` to `Variables`)
- Modify: `worker/src/lib/auth.ts` (set `identity` in both branches of `authenticate`)
- Create: `worker/src/routes/me.ts`
- Modify: `worker/src/index.ts` (import and mount `meRoutes` next to `tokenRoutes`)
- Test: `worker/test/me.test.ts`

**Step 1: Write the failing test** (`worker/test/me.test.ts`)

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { client, makeToken, reset } from "./helpers";

beforeEach(reset);

describe("GET /api/me", () => {
  it("reports the calling token's name, scopes and expiry", async () => {
    const secret = await makeToken(["read"], { name: "phone", expiresAt: "2099-01-01T00:00:00.000Z" });
    const res = await client(secret)("GET", "/api/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "phone", scopes: ["read"], expiresAt: "2099-01-01T00:00:00.000Z" });
  });

  it("works for a token with no expiry and never returns the secret or hash", async () => {
    const secret = await makeToken(["write"]);
    const res = await client(secret)("GET", "/api/me");
    expect(res.body.expiresAt).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(Object.keys(res.body).sort()).toEqual(["expiresAt", "name", "scopes"]);
  });

  it("rejects missing, revoked and expired tokens", async () => {
    const revoked = await makeToken(["read"], { revokedAt: "2026-01-01T00:00:00.000Z" });
    const expired = await makeToken(["read"], { expiresAt: "2026-01-01T00:00:00.000Z" });
    expect((await client()("GET", "/api/me")).status).toBe(401);
    expect((await client(revoked)("GET", "/api/me")).status).toBe(401);
    expect((await client(expired)("GET", "/api/me")).status).toBe(401);
  });
});
```

**Step 2: Run it to see it fail**

Run: `npm test -w @claudia/worker -- me.test`
Expected: FAIL (404 for `/api/me`).

**Step 3: Implement**

`shared/src/schemas.ts`, after `TokenCreatedSchema`:

```ts
export const MeSchema = z
  .object({
    name: z.string(),
    scopes: z.array(z.enum(SCOPES)),
    expiresAt: Timestamp.nullable(),
  })
  .openapi("Me");
```
and add `export type Me = z.infer<typeof MeSchema>;` with the other type exports.

`worker/src/lib/router.ts` `Variables`:

```ts
Variables: { db: Db; actor: Actor; scopes: Scope[]; identity: { name: string; expiresAt: string | null } };
```

`worker/src/lib/auth.ts`: in the internal branch add `c.set("identity", { name: "MCP connection", expiresAt: null });` beside `c.set("scopes", granted)`. In the token branch add `c.set("identity", { name: row.name, expiresAt: row.expiresAt });` beside `c.set("scopes", row.scopes as Scope[])`.

`worker/src/routes/me.ts`:

```ts
import { createRoute } from "@hono/zod-openapi";
import { MeSchema } from "@claudia/shared";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

export const meRoutes = newRouter().openapi(
  createRoute({
    method: "get",
    path: "/api/me",
    tags: ["System"],
    summary: "Who the calling token is",
    description: "The token's name, scopes and expiry. Never the secret. Any valid token can call it.",
    responses: { 200: jsonResponse(MeSchema, "The calling token"), ...commonErrors },
  }),
  (c) => c.json({ ...c.var.identity, scopes: c.var.scopes }, 200),
);
```

`worker/src/index.ts`: `import { meRoutes } from "./routes/me";` and `app.route("/", meRoutes);` before `tokenRoutes`.

**Step 4: Run tests and typecheck**

Run: `npm test -w @claudia/worker && npm run typecheck`
Expected: all pass (the existing 158 plus 3).

**Step 5: Commit**

```bash
git add shared worker
git commit -m "Add GET /api/me to report the calling token"
```

### Task 2: Web test setup

**Files:**
- Modify: `web/package.json` (devDependencies)
- Modify: `web/vite.config.ts`
- Create: `web/src/test-setup.ts`

**Step 1:** Install: `npm install -D -w @claudia/web jsdom @testing-library/react @testing-library/user-event`. (`.npmrc` already sets `legacy-peer-deps`.)

**Step 2:** `web/vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8787", "/mcp": "http://localhost:8787" } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
```

`web/src/test-setup.ts`:

```ts
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
```

**Step 3:** Run `npm test -w @claudia/web` (still no tests; `--passWithNoTests`) and `npm run typecheck`. Expected: pass.

**Step 4: Commit**

```bash
git add web package.json package-lock.json
git commit -m "Set up web tests with jsdom and Testing Library"
```

### Task 3: Token store and API helper

**Files:**
- Create: `web/src/session/store.ts`, `web/src/session/api.ts`
- Test: `web/src/session/api.test.ts`

**Step 1: Failing test** (`web/src/session/api.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiNetworkError, ApiUnauthorized, apiFetch, fetchMe } from "./api";
import { tokenStore } from "./store";

describe("tokenStore", () => {
  it("round-trips and clears", () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set("cl_abc");
    expect(tokenStore.get()).toBe("cl_abc");
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set("cl_abc")).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("apiFetch", () => {
  it("sends the bearer token and the client header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("cl_abc", "/api/me");
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/me");
    expect(init.headers).toMatchObject({ Authorization: "Bearer cl_abc", "X-Claudia-Client": "web" });
  });

  it("throws ApiUnauthorized on 401 and ApiNetworkError when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(apiFetch("x", "/api/me")).rejects.toBeInstanceOf(ApiUnauthorized);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("x", "/api/me")).rejects.toBeInstanceOf(ApiNetworkError);
  });
});

describe("fetchMe", () => {
  it("parses the response", async () => {
    const me = { name: "laptop", scopes: ["write"], expiresAt: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 })));
    expect(await fetchMe("cl_abc")).toEqual(me);
  });
});
```

**Step 2:** Run `npm test -w @claudia/web`. Expected: FAIL (modules missing).

**Step 3: Implement**

`web/src/session/store.ts`:

```ts
const KEY = "claudia.token";

// Storage can be blocked (private windows, strict settings). Then the session lasts until the tab closes.
export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(token: string) {
    try { localStorage.setItem(KEY, token); } catch { /* kept in memory only */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  },
};
```

`web/src/session/api.ts`:

```ts
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
```

**Step 4:** Run `npm test -w @claudia/web && npm run typecheck`. Expected: pass.

**Step 5: Commit**

```bash
git add web
git commit -m "Add the web token store and API helper"
```

### Task 4: Session provider, sign-in screen and shell

**Files:**
- Create: `web/src/session/SessionProvider.tsx`, `web/src/SignIn.tsx`, `web/src/Shell.tsx`, `web/src/styles.css`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`
- Test: `web/src/App.test.tsx`

**Step 1: Failing test** (`web/src/App.test.tsx`)

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useSession } from "./session/SessionProvider";
import { tokenStore } from "./session/store";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderApp(extra?: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
      {extra}
    </QueryClientProvider>,
  );
}

async function signInWith(token: string) {
  await userEvent.type(screen.getByLabelText("API token"), token);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("sign-in", () => {
  it("shows the form when there is no stored token", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderApp();
    expect(screen.getByLabelText("API token")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks a pasted token, stores it and shows who is signed in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(me));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await signInWith("  cl_good  ");
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
    expect(screen.getByText(/write/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_good");
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer cl_good");
  });

  it("does not store a rejected token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: {} }, 401)));
    renderApp();
    await signInWith("cl_bad");
    expect(await screen.findByText("That token isn't valid or has expired.")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("says so when the server cannot be reached and does not store the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();
    await signInWith("cl_x");
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });
});

describe("stored token", () => {
  it("signs in on load when the token is still good", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(me)));
    renderApp();
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
  });

  it("clears a rejected token on load and says why", async () => {
    tokenStore.set("cl_revoked");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: {} }, 401)));
    renderApp();
    expect(await screen.findByText("That token isn't valid or has expired.")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("keeps the token when offline and recovers on retry", async () => {
    tokenStore.set("cl_stored");
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(json(me));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_stored");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
  });
});

describe("signed in", () => {
  it("signs out and forgets the token", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(me)));
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.getByLabelText("API token")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("signs out when a later call returns 401", async () => {
    tokenStore.set("cl_stored");
    const fetchMock = vi.fn().mockResolvedValueOnce(json(me)).mockResolvedValue(json({ error: {} }, 401));
    vi.stubGlobal("fetch", fetchMock);
    function Probe() {
      const { api } = useSession();
      return <button onClick={() => api("/api/folders").catch(() => {})}>probe</button>;
    }
    renderApp(<Probe />);
    await userEvent.click(await screen.findByRole("button", { name: "probe" }));
    await waitFor(() => expect(screen.getByText("That token isn't valid or has expired.")).toBeTruthy());
    expect(tokenStore.get()).toBeNull();
  });
});
```

Note: `Probe` renders outside the signed-in branch, so `useSession()` must work anywhere under the provider and `api` must throw if not signed in.

**Step 2:** Run `npm test -w @claudia/web`. Expected: FAIL (modules missing).

**Step 3: Implement**

`web/src/session/SessionProvider.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "@claudia/shared";
import { ApiNetworkError, ApiUnauthorized, apiFetch, fetchMe } from "./api";
import { tokenStore } from "./store";

export const INVALID_TOKEN = "That token isn't valid or has expired.";
export const UNREACHABLE = "Can't reach Claudia. Check your connection and try again.";

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "offline" }
  | { status: "signedIn"; token: string; me: Me };

interface Session {
  state: SessionState;
  /** Checks the token, stores it if good. Resolves to an error message, or null on success. */
  signIn(token: string): Promise<string | null>;
  signOut(notice?: string): void;
  retry(): void;
  /** Authenticated fetch. A 401 signs out. */
  api(path: string, init?: RequestInit): Promise<Response>;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(Ctx);
  if (!session) throw new Error("useSession needs a SessionProvider");
  return session;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>(() => (tokenStore.get() ? { status: "loading" } : { status: "signedOut" }));
  const [attempt, setAttempt] = useState(0);

  const signOut = useCallback(
    (notice?: string) => {
      tokenStore.clear();
      queryClient.clear();
      setState({ status: "signedOut", notice });
    },
    [queryClient],
  );

  // Check a stored token on load, and again on retry.
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    let live = true;
    fetchMe(token)
      .then((me) => live && setState({ status: "signedIn", token, me }))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiUnauthorized) signOut(INVALID_TOKEN);
        else setState({ status: "offline" });
      });
    return () => {
      live = false;
    };
  }, [attempt, signOut]);

  const signIn = useCallback(async (raw: string) => {
    const token = raw.trim();
    try {
      const me = await fetchMe(token);
      tokenStore.set(token);
      setState({ status: "signedIn", token, me });
      return null;
    } catch (e) {
      if (e instanceof ApiUnauthorized) return INVALID_TOKEN;
      if (e instanceof ApiNetworkError) return UNREACHABLE;
      return "Something went wrong. Try again.";
    }
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const token = state.status === "signedIn" ? state.token : null;
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!token) throw new Error("Not signed in");
      try {
        return await apiFetch(token, path, init);
      } catch (e) {
        if (e instanceof ApiUnauthorized) signOut(INVALID_TOKEN);
        throw e;
      }
    },
    [token, signOut],
  );

  const value = useMemo(() => ({ state, signIn, signOut, retry, api }), [state, signIn, signOut, retry, api]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

`web/src/SignIn.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { useSession } from "./session/SessionProvider";

export function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useSession();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(await signIn(token));
    setBusy(false);
  }

  const message = error ?? notice;
  return (
    <main>
      <h1>Claudia</h1>
      <form onSubmit={submit}>
        <label htmlFor="token">API token</label>
        <input id="token" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
        {message && <p role="alert">{message}</p>}
        <button type="submit" disabled={busy}>Sign in</button>
      </form>
    </main>
  );
}
```

`web/src/Shell.tsx`:

```tsx
import { useSession } from "./session/SessionProvider";

export function Shell() {
  const { state, signOut } = useSession();
  if (state.status !== "signedIn") return null;
  return (
    <main>
      <h1>Claudia</h1>
      <p>Signed in as {state.me.name} ({state.me.scopes.join(", ")})</p>
      <button onClick={() => signOut()}>Sign out</button>
    </main>
  );
}
```

`web/src/App.tsx`:

```tsx
import { Shell } from "./Shell";
import { SignIn } from "./SignIn";
import { SessionProvider, useSession } from "./session/SessionProvider";

function Gate() {
  const { state, retry } = useSession();
  switch (state.status) {
    case "loading":
      return <main><p>Checking…</p></main>;
    case "offline":
      return (
        <main>
          <h1>Claudia</h1>
          <p>Can't reach Claudia. Your token is still saved.</p>
          <button onClick={retry}>Try again</button>
        </main>
      );
    case "signedOut":
      return <SignIn notice={state.notice} />;
    case "signedIn":
      return <Shell />;
  }
}

export function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
```

`web/src/styles.css`:

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; }
main { max-width: 28rem; margin: 0 auto; padding: 2rem 1rem; }
form { display: grid; gap: 0.75rem; }
input, button { font: inherit; font-size: 1rem; padding: 0.6rem 0.75rem; }
[role="alert"] { color: #b00020; margin: 0; }
```

`web/src/main.tsx`: add `import "./styles.css";`.

**Step 4:** Run `npm test -w @claudia/web && npm run typecheck && npm run build`. Expected: all pass; the build succeeds.

**Step 5: Commit**

```bash
git add web
git commit -m "Add token sign-in to the web app"
```

### Task 5: Docs, review and hands-on check

**Files:**
- Modify: `README.md`, `CLAUDE.md` (web app signs in with a token; how to get one for the browser)
- Modify: `docs/plans/2026-10-26-web-sign-in-design.md` (status: built)

**Step 1:** README and CLAUDE.md: add that the web app asks for an API token on first use (mint one with `npm run token:create -w @claudia/worker -- --remote --name browser --scopes write`, shown once) and keeps it in the browser's localStorage; Sign out removes it.

**Step 2:** Run `npm test && npm run typecheck && npm run build`. Expected: all pass.

**Step 3: Commit**

```bash
git add -A
git commit -m "Document web sign-in"
```

**Step 4 (Andrew):** After a push and a passing deploy, open `https://claudia.alphajuliet.com/`, sign in with a write token (`pbcopy < ~/.config/claudia/write-token`, then paste), reload to confirm it stays signed in, sign out, and try a nonsense token.

**Step 5:** On success: move the board card to DONE and add a dated `#Decision` line to the Obsidian note (web sign-in: `GET /api/me`, token in localStorage, 401 signs out, offline keeps the token).
