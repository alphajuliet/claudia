import { env } from "cloudflare:workers";
import { provider } from "../src";

export const BASE = "https://claudia.alphajuliet.com";
export const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

export const send = (path: string, init?: RequestInit) => provider.fetch(new Request(BASE + path, { redirect: "manual", ...init }), env, ctx);

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function register(name = "Test client", redirectUris = [CALLBACK]) {
  const res = await send("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  return { status: res.status, body: await res.json<any>() };
}

export async function pkce() {
  const verifier = "v".repeat(64);
  return { verifier, challenge: b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))) };
}

/** The authorize URL path + query for a registered client. */
export function authorizePath(clientId: string, challenge: string, scope = "tasks:read tasks:write", state = "st8") {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state, scope, resource: BASE + "/mcp" });
  return "/authorize?" + q;
}

/** GET the consent page; returns the handle, the cookie to send back, and the HTML. */
export async function openConsent(path: string) {
  const res = await send(path);
  const html = await res.text();
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  return { res, html, handle: /name="handle" value="([^"]*)"/.exec(html)?.[1] ?? "", cookie: setCookie.split(";")[0] ?? "" };
}

export const submit = (path: string, cookie: string, fields: Record<string, string>) =>
  send(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: new URLSearchParams(fields) });

export async function exchange(clientId: string, code: string, verifier: string) {
  const res = await send("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CALLBACK, code_verifier: verifier, resource: BASE + "/mcp" }),
  });
  return { status: res.status, body: await res.json<any>() };
}

/** Run the whole flow with the right passphrase and return the token response. */
export async function authorise(scope = "tasks:read tasks:write") {
  const { body: client } = await register();
  const { verifier, challenge } = await pkce();
  const path = authorizePath(client.client_id, challenge, scope);
  const { handle, cookie } = await openConsent(path);
  const res = await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" });
  const code = new URL(res.headers.get("Location")!).searchParams.get("code")!;
  const tok = await exchange(client.client_id, code, verifier);
  return { client, verifier, ...tok };
}
