import type { Scope } from "./router";

/** Random per isolate and never sent anywhere: only in-process callers can present it. */
export const INTERNAL_KEY = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Headers for an in-process call to the app on behalf of an OAuth grant. Admin is never granted. */
export const internalHeaders = (scopes: readonly Scope[]): Record<string, string> => ({
  "X-Claudia-Internal": INTERNAL_KEY,
  "X-Claudia-Scopes": scopes.filter((s) => s !== "admin").join(","),
  "X-Claudia-Client": "mcp",
});
