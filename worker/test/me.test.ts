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
