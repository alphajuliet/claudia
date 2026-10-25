const FIXED = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);

/** Redirect URIs a client may register: Claude's hosted callbacks and loopback addresses (Claude Code). */
export function redirectAllowed(uri: string): boolean {
  if (FIXED.has(uri)) return true;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
