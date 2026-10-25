import { beforeEach, describe, expect, it } from "vitest";
import { client, makeToken, reset } from "./helpers";

beforeEach(reset);

describe("auth", () => {
  it("serves health and the spec without a token", async () => {
    const api = client();
    expect((await api("GET", "/api/health")).body).toEqual({ ok: true, service: "claudia" });
    const spec = await api("GET", "/api/openapi.json");
    expect(spec.status).toBe(200);
    expect(Object.keys(spec.body.paths)).toContain("/api/folders");
    expect(spec.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("rejects missing, malformed and unknown tokens", async () => {
    expect((await client()("GET", "/api/folders")).status).toBe(401);
    expect((await client("nope")("GET", "/api/folders")).status).toBe(401);
    expect((await client("cl_unknown")("GET", "/api/folders")).status).toBe(401);
  });

  it("rejects revoked and expired tokens", async () => {
    const revoked = await makeToken(["admin"], { revokedAt: "2026-01-01T00:00:00.000Z" });
    const expired = await makeToken(["admin"], { expiresAt: "2026-01-01T00:00:00.000Z" });
    expect((await client(revoked)("GET", "/api/folders")).status).toBe(401);
    expect((await client(expired)("GET", "/api/folders")).status).toBe(401);
  });

  it("enforces scopes: read < write < admin", async () => {
    const read = client(await makeToken(["read"]));
    const write = client(await makeToken(["write"]));
    const folder = { name: "Home", context: "home" };
    expect((await read("GET", "/api/folders")).status).toBe(200);
    expect((await read("POST", "/api/folders", folder)).status).toBe(403);
    expect((await write("GET", "/api/folders")).status).toBe(200);
    expect((await write("POST", "/api/folders", folder)).status).toBe(201);
    expect((await write("GET", "/api/tokens")).status).toBe(403);
  });

  it("returns errors in a consistent shape", async () => {
    const api = client(await makeToken());
    const bad = await api("POST", "/api/folders", { name: "", context: "school" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
    const missing = await api("GET", "/api/folders/01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(missing).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    expect((await api("GET", "/api/nothing")).status).toBe(404);
  });
});

describe("tokens", () => {
  it("creates a token whose secret works once and is never listed", async () => {
    const admin = client(await makeToken());
    const created = await admin("POST", "/api/tokens", { name: "shortcut", scopes: ["write"] });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^cl_/);

    expect((await client(created.body.token)("GET", "/api/folders")).status).toBe(200);
    const list = await admin("GET", "/api/tokens");
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);
    expect(JSON.stringify(list.body)).not.toContain("hash");
  });

  it("revokes a token", async () => {
    const admin = client(await makeToken());
    const { body } = await admin("POST", "/api/tokens", { name: "old", scopes: ["read"] });
    expect((await admin("DELETE", `/api/tokens/${body.id}`)).body.revokedAt).not.toBeNull();
    expect((await client(body.token)("GET", "/api/folders")).status).toBe(401);
    expect((await admin("DELETE", `/api/tokens/${body.id}`)).status).toBe(404);
  });
});
