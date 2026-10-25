declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OAUTH_KV: KVNamespace;
    /** Worker secret (`wrangler secret`; `.dev.vars` locally). Gates the OAuth consent page. */
    OWNER_PASSPHRASE: string;
    /** Injected at runtime by the OAuth provider wrapper. */
    OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  }
}
