import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events } from "../src/db/schema";
import { db, makeToken, reset } from "./helpers";
import { authorise, BASE, exchange, openConsent, authorizePath, pkce, register, send, submit } from "./oauth-helpers";

let id = 0;
async function rpc(token: string, method: string, params?: unknown) {
  const res = await send("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "claudia.alphajuliet.com", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await res.text();
  const data = /^data: (.*)$/m.exec(text)?.[1];
  return { status: res.status, json: data ? JSON.parse(data) : text ? JSON.parse(text) : null };
}
const tools = async (token: string) => ((await rpc(token, "tools/list")).json.result.tools as { name: string }[]);
const call = async (token: string, name: string, args: object = {}) => (await rpc(token, "tools/call", { name, arguments: args })).json;

beforeEach(async () => {
  await reset();
  await env.OAUTH_KV.delete("passphrase:failures");
});

describe("discovery", () => {
  it("serves the protected resource and authorization server documents", async () => {
    const prm = await (await send("/.well-known/oauth-protected-resource/mcp")).json<any>();
    expect(prm.resource).toBe(BASE + "/mcp");
    expect(prm.authorization_servers).toEqual([BASE]);
    const asm = await (await send("/.well-known/oauth-authorization-server")).json<any>();
    expect(asm.authorization_endpoint).toBe(BASE + "/authorize");
    expect(asm.token_endpoint).toBe(BASE + "/token");
    expect(asm.registration_endpoint).toBe(BASE + "/register");
    expect(asm.code_challenge_methods_supported).toEqual(["S256"]);
  });
});

describe("the OAuth flow", () => {
  it("issues an access token and a refresh token after the passphrase", async () => {
    const { status, body } = await authorise();
    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it("lets a write grant use all 22 tools, logging changes as actor mcp", async () => {
    const { body } = await authorise();
    expect(await tools(body.access_token)).toHaveLength(22);
    const list = JSON.parse((await call(body.access_token, "create_list", { name: "L" })).result.content[0].text);
    const task = JSON.parse((await call(body.access_token, "create_task", { listId: list.id, title: "T" })).result.content[0].text);
    const [row] = await db.select().from(events).where(eq(events.entityId, task.id));
    expect(row).toMatchObject({ type: "created", actor: "mcp" });
  });

  it("limits a tasks:read grant to the 7 read tools", async () => {
    const { body } = await authorise("tasks:read");
    expect(await tools(body.access_token)).toHaveLength(7);
    const res = await call(body.access_token, "create_list", { name: "Sneaky" });
    expect(res.error).toEqual({ code: -32602, message: "Tool create_list not found" });
  });

  it("refreshes to a new access token that works", async () => {
    const { client, body } = await authorise();
    const res = await send("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: body.refresh_token, client_id: client.client_id }),
    });
    const next = await res.json<any>();
    expect(res.status).toBe(200);
    expect(next.access_token).toBeTruthy();
    expect(next.access_token).not.toBe(body.access_token);
    expect(await tools(next.access_token)).toHaveLength(22);
  });

  it("does not let the code be exchanged with the wrong PKCE verifier", async () => {
    const { body: client } = await register();
    const { challenge } = await pkce();
    const path = authorizePath(client.client_id, challenge);
    const { handle, cookie } = await openConsent(path);
    const code = new URL((await submit(path, cookie, { handle, passphrase: "test-passphrase", decision: "approve" })).headers.get("Location")!).searchParams.get("code")!;
    expect((await exchange(client.client_id, code, "x".repeat(64))).status).toBe(400);
  });
});

describe("what an OAuth token cannot do", () => {
  it("cannot reach /api/* directly", async () => {
    const { body } = await authorise();
    const res = await send("/api/folders", { headers: { Authorization: `Bearer ${body.access_token}` } });
    expect(res.status).toBe(401);
  });

  it("cannot present a forged internal identity on /api/*", async () => {
    const res = await send("/api/folders", { headers: { "X-Claudia-Internal": "guess", "X-Claudia-Scopes": "write" } });
    expect(res.status).toBe(401);
  });

  it("cannot smuggle X-Claudia-* headers through /mcp", async () => {
    const { body } = await authorise("tasks:read");
    const res = await send("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "claudia.alphajuliet.com", Accept: "application/json, text/event-stream", Authorization: `Bearer ${body.access_token}`, "X-Claudia-Scopes": "write,admin", "X-Claudia-Client": "import" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/list" }),
    });
    const data = /^data: (.*)$/m.exec(await res.text())?.[1];
    expect(JSON.parse(data!).result.tools).toHaveLength(7);
  });
});

describe("Claude Code's API token", () => {
  it("still works on /mcp", async () => {
    const token = await makeToken(["write"]);
    expect(await tools(token)).toHaveLength(22);
  });
});
