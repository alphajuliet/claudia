// worker/test/internal-auth.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src";
import { INTERNAL_KEY, internalHeaders } from "../src/lib/internal";
import { reset } from "./helpers";

// Hono's app.request has no execution context unless given one.
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const get = (path: string, headers: Record<string, string>) => app.request(path, { headers }, env, ctx);
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) }, env, ctx);

beforeEach(reset);

describe("internal identity", () => {
  it("lets the in-process key read with read scope, but not write", async () => {
    expect((await get("/api/folders", internalHeaders(["read"]))).status).toBe(200);
    expect((await post("/api/folders", internalHeaders(["read"]), { name: "F", context: "home" })).status).toBe(403);
  });

  it("lets the in-process key write with write scope", async () => {
    expect((await post("/api/folders", internalHeaders(["write"]), { name: "F", context: "home" })).status).toBe(201);
  });

  it("ignores a guessed key", async () => {
    const res = await get("/api/folders", { "X-Claudia-Internal": "guess", "X-Claudia-Scopes": "write" });
    expect(res.status).toBe(401);
    expect(INTERNAL_KEY.length).toBeGreaterThanOrEqual(32);
  });

  it("never grants admin through the internal identity", async () => {
    const res = await get("/api/tokens", internalHeaders(["admin"]));
    expect(res.status).toBe(403);
  });
});
