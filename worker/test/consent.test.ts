import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FAILURES } from "../src/oauth/passphrase";
import { provider } from "../src";
import { authorizePath, BASE, ctx, openConsent, pkce, register, send, submit } from "./oauth-helpers";

beforeEach(async () => {
  await env.OAUTH_KV.delete("passphrase:failures");
});

async function start(name?: string, scope?: string) {
  const { body: client } = await register(name);
  const { challenge } = await pkce();
  const path = authorizePath(client.client_id, challenge, scope);
  return { client, path, ...(await openConsent(path)) };
}

describe("GET /authorize", () => {
  it("shows the client, the redirect host and a passphrase field, with the consent cookie and strict headers", async () => {
    const { res, html, cookie } = await start("My Connector");
    expect(res.status).toBe(200);
    expect(html).toContain("Connect to Claudia");
    expect(html).toContain("My Connector");
    expect(html).toContain("claude.ai");
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"[^>]*autofocus/);
    expect(html).not.toContain("test-passphrase");
    expect(html).not.toContain("<script");
    expect(cookie).toMatch(/^__Host-oauth-consent-/);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  });

  it("escapes a hostile client name", async () => {
    const { html } = await start("<script>x</script>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&#60;script&#62;x&#60;/script&#62;");
  });

  it("renders an error rather than redirecting for an unknown client", async () => {
    const res = await openConsent("/authorize?response_type=code&client_id=nope&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback");
    expect(res.res.status).toBe(400);
    expect(res.res.headers.get("Location")).toBeNull();
    expect(res.res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("POST /authorize", () => {
  it("redirects to the callback with a code and the original state after the right passphrase", async () => {
    const { path, handle, cookie } = await start();
    const res = await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(loc.searchParams.get("code")).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("st8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("re-renders with a message and does not redirect on a wrong passphrase, and the right one then still works", async () => {
    const { path, handle, cookie } = await start();
    const bad = await submit(path, cookie, { handle, passphrase: "wrong", decision: "approve" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("Location")).toBeNull();
    const html = await bad.text();
    expect(html).toContain("That passphrase is not right.");
    expect(html).not.toContain("wrong\"");
    const good = await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" });
    expect(good.status).toBe(302);
  });

  it("refuses even the right passphrase after too many failures", async () => {
    const { path, handle, cookie } = await start();
    for (let i = 0; i < MAX_FAILURES; i++) await submit(path, cookie, { handle, passphrase: "bad", decision: "approve" });
    const res = await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Location")).toBeNull();
    expect(await res.text()).toContain("Too many attempts. Try again in 15 minutes.");
  });

  it("says sign-in is not set up, with a 503 and no counter change, when no passphrase is configured", async () => {
    const { path, handle, cookie } = await start();
    for (const OWNER_PASSPHRASE of ["", undefined]) {
      const res = await provider.fetch(
        new Request(BASE + path, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: new URLSearchParams({ handle, passphrase: "anything", decision: "approve" }) }),
        { ...env, OWNER_PASSPHRASE } as typeof env,
        ctx,
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("Location")).toBeNull();
      const html = await res.text();
      expect(html).toContain("Sign-in isn&#39;t set up on this server.");
      expect(html).not.toContain("That passphrase is not right.");
      expect(await env.OAUTH_KV.get("passphrase:failures")).toBeNull();
    }
  });

  it("redirects with access_denied on Deny, without needing the passphrase", async () => {
    const { path, handle, cookie } = await start();
    const res = await submit(path, cookie, { handle, decision: "deny" });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("code")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses a POST without the consent cookie or with a bad handle", async () => {
    const { path, handle, cookie } = await start();
    const noCookie = await submit(path, "", { handle, passphrase: "test-passphrase", decision: "approve" });
    expect(noCookie.status).toBe(400);
    expect(noCookie.headers.get("Location")).toBeNull();
    const badHandle = await submit(path, cookie, { handle: "forged", passphrase: "test-passphrase", decision: "approve" });
    expect(badHandle.status).toBe(400);
    expect(badHandle.headers.get("Location")).toBeNull();
  });

  it("does not allow a handle to be used twice", async () => {
    const { path, handle, cookie } = await start();
    expect((await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" })).status).toBe(302);
    expect((await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" })).status).toBe(400);
  });
});

describe("POST /register", () => {
  it("rejects a redirect URI outside the allowlist", async () => {
    const res = await register("Evil", ["https://evil.example/cb"]);
    expect(res.status).toBe(400);
    expect(res.body.client_id).toBeUndefined();
  });

  it("rejects a mix that includes a disallowed URI, and accepts loopback", async () => {
    expect((await register("Mixed", ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"])).status).toBe(400);
    expect((await register("CLI", ["http://localhost:53682/callback"])).status).toBe(201);
  });
});

describe("a client whose redirect URI is not allowed (client metadata document)", () => {
  const CLIENT_ID = "https://evil-client.example/client.json";
  const EVIL = "https://evil.example/cb";
  const real = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === CLIENT_ID) {
        return Response.json({ client_id: CLIENT_ID, client_name: "Evil Client", redirect_uris: [EVIL], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] });
      }
      return real(input, init);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = real;
  });

  const path = async (extra: Record<string, string> = {}) => {
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: EVIL, code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "tasks:read", resource: BASE + "/mcp", ...extra });
    return "/authorize?" + q;
  };

  const expectPlain400 = async (res: Response) => {
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).not.toContain("Evil Client");
  };

  it("shows a plain error on GET, not the consent page or a redirect", async () => {
    await expectPlain400(await send(await path()));
  });

  it("does not redirect to the client on a PKCE or response_type error", async () => {
    await expectPlain400(await send(await path({ response_type: "token" })));
    await expectPlain400(await send(await path({ code_challenge_method: "plain" })));
  });

  it("refuses the POST without checking the passphrase or redirecting", async () => {
    const res = await submit(await path(), "", { handle: "h", passphrase: "test-passphrase", decision: "approve" });
    await expectPlain400(res);
    const wrong = await submit(await path(), "", { handle: "h", passphrase: "wrong", decision: "approve" });
    await expectPlain400(wrong);
    expect(await env.OAUTH_KV.get("passphrase:failures")).toBeNull();
  });

  it("refuses a deny POST without redirecting to the client", async () => {
    await expectPlain400(await submit(await path(), "", { handle: "h", decision: "deny" }));
  });
});
