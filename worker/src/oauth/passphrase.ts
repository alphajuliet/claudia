export const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;
const KEY = "passphrase:failures";

export type PassphraseResult = "ok" | "wrong" | "locked";

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** Constant-time comparison of two strings of any length (compares their SHA-256 digests). */
async function same(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await digest(a), await digest(b));
}

/**
 * Check the owner passphrase, with a global throttle: after MAX_FAILURES wrong
 * attempts inside the window, everything is refused until the counter expires.
 * Refused attempts do not extend the lockout.
 *
 * The count is best effort. KV is not atomic, so parallel guesses can race and
 * undercount, and the counter is global, so anyone can burn it and lock the
 * owner out for a while (a nuisance, not a bypass). The passphrase is long and
 * generated, so guessing stays impractical. A KV write that fails (an error or a
 * rate limit) counts as a wrong attempt; this function never throws on it.
 */
export async function checkPassphrase(kv: KVNamespace, supplied: string, expected: string | undefined): Promise<PassphraseResult> {
  const failures = Number((await kv.get(KEY)) ?? 0);
  if (failures >= MAX_FAILURES) return "locked";

  if (expected && supplied && (await same(supplied, expected))) {
    try {
      await kv.delete(KEY);
    } catch {
      // The right passphrase still works; the old count simply expires.
    }
    return "ok";
  }
  try {
    await kv.put(KEY, String(failures + 1), { expirationTtl: WINDOW_SECONDS });
  } catch {
    // Best effort: a failed write is still a wrong attempt.
  }
  return "wrong";
}
