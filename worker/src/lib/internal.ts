import type { Scope } from "./router";

let key: string | undefined;

/**
 * Random per isolate and never sent anywhere: only in-process callers can present it.
 * Made on first use, because Workers refuse random values in global scope.
 */
export const internalKey = (): string =>
  (key ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""));

/** Headers for an in-process call to the app on behalf of an OAuth grant. Admin is never granted. */
export const internalHeaders = (scopes: readonly Scope[]): Record<string, string> => ({
  "X-Claudia-Internal": internalKey(),
  "X-Claudia-Scopes": scopes.filter((s) => s !== "admin").join(","),
  "X-Claudia-Client": "mcp",
});
