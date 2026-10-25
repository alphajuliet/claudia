import { describe, expect, it } from "vitest";
import { redirectAllowed } from "../src/oauth/policy";

describe("redirectAllowed", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:53682/callback",
    "http://127.0.0.1:8123/callback",
  ])("allows %s", (u) => expect(redirectAllowed(u)).toBe(true));

  it.each([
    "https://evil.example/api/mcp/auth_callback",
    "https://claude.ai/other",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "http://evil.example/callback",
    "http://localhost.evil.example/callback",
    "https://localhost:8123/callback",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (u) => expect(redirectAllowed(u)).toBe(false));
});
