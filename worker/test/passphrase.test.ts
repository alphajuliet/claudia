// worker/test/passphrase.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { checkPassphrase, MAX_FAILURES } from "../src/oauth/passphrase";

const SECRET = "correct horse battery staple";

beforeEach(async () => {
  await env.OAUTH_KV.delete("passphrase:failures");
});

describe("checkPassphrase", () => {
  it("accepts the right passphrase", async () => {
    expect(await checkPassphrase(env.OAUTH_KV, SECRET, SECRET)).toBe("ok");
  });

  it("rejects a wrong or empty passphrase", async () => {
    expect(await checkPassphrase(env.OAUTH_KV, "nope", SECRET)).toBe("wrong");
    expect(await checkPassphrase(env.OAUTH_KV, "", SECRET)).toBe("wrong");
  });

  it("locks out after the maximum failures, even for the right passphrase", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect(await checkPassphrase(env.OAUTH_KV, "bad", SECRET)).toBe("wrong");
    expect(await checkPassphrase(env.OAUTH_KV, "bad", SECRET)).toBe("locked");
    expect(await checkPassphrase(env.OAUTH_KV, SECRET, SECRET)).toBe("locked");
  });

  it("clears the count after a success", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await checkPassphrase(env.OAUTH_KV, "bad", SECRET);
    expect(await checkPassphrase(env.OAUTH_KV, SECRET, SECRET)).toBe("ok");
    expect(await checkPassphrase(env.OAUTH_KV, "bad", SECRET)).toBe("wrong"); // count restarted, not locked
  });

  it("refuses everything when no passphrase is configured", async () => {
    expect(await checkPassphrase(env.OAUTH_KV, "", "")).toBe("wrong");
    expect(await checkPassphrase(env.OAUTH_KV, "anything", undefined)).toBe("wrong");
  });

  it("treats a rejected KV write as a wrong attempt, never throwing", async () => {
    const kv = { get: async () => null, delete: async () => {}, put: async () => { throw new Error("KV put() limit exceeded"); } } as unknown as KVNamespace;
    expect(await checkPassphrase(kv, "bad", SECRET)).toBe("wrong");
    expect(await checkPassphrase(kv, SECRET, SECRET)).toBe("ok");
  });
});
