// worker/test/mcp-response.test.ts
import { describe, expect, it } from "vitest";
import { parseApiResponse } from "../src/mcp/response";

describe("parseApiResponse", () => {
  it("parses a JSON body", async () => {
    const res = await parseApiResponse(Response.json({ a: 1 }));
    expect(res).toEqual({ ok: true, status: 200, json: { a: 1 } });
  });

  it("keeps the error status and JSON of a failed call", async () => {
    const res = await parseApiResponse(Response.json({ error: { code: "x" } }, { status: 404 }));
    expect(res).toEqual({ ok: false, status: 404, json: { error: { code: "x" } } });
  });

  it("treats an empty 204 as success with no JSON", async () => {
    const res = await parseApiResponse(new Response(null, { status: 204 }));
    expect(res).toEqual({ ok: true, status: 204, json: undefined });
  });

  it("treats an HTML 502 as a failure with no JSON", async () => {
    const res = await parseApiResponse(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(res).toEqual({ ok: false, status: 502, json: undefined });
  });

  it("treats an HTML 200 as a failure, not as success", async () => {
    const res = await parseApiResponse(new Response("<html>Login</html>", { status: 200 }));
    expect(res).toEqual({ ok: false, status: 200, json: undefined });
  });
});
