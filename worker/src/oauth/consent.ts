import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { checkPassphrase } from "./passphrase";
import { redirectAllowed } from "./policy";

/** Scopes this server issues. `tasks:write` gives the `write` scope, `tasks:read` gives `read`; never admin. */
export const OAUTH_SCOPES = ["tasks:read", "tasks:write"];

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};

function applyPageHeaders(headers: Headers) {
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  return headers;
}

function page(details: ConsentDescription, handle: string, message?: string): string {
  const client = escape(details.clientName);
  const host = escape(details.redirectHost);
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Connect to Claudia</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
  input[type=password] { width: 100%; box-sizing: border-box; font: inherit; padding: .5rem; margin: .25rem 0 1rem; }
  button { font: inherit; padding: .5rem 1.25rem; margin-right: .5rem; }
  .error { color: #b00020; font-weight: 600; }
</style>
</head>
<body>
<h1>Connect to Claudia</h1>
<p><strong>${client}</strong> wants to read and change your tasks. It will return you to <strong>${host}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your own computer.</strong> Continue only if you just started connecting from it.</p>" : ""}
${message ? `<p class="error" role="alert">${escape(message)}</p>` : ""}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <label for="passphrase">Owner passphrase</label>
  <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" autofocus required>
  <button name="decision" value="approve">Allow</button>
  <button name="decision" value="deny" formnovalidate>Deny</button>
</form>
</body>
</html>`;
}

const text = (message: string, status: number) =>
  new Response(escape(message), { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Reduce what the client asked for to scopes we issue; asking for nothing means everything. */
const grantable = (requested: string[]) => {
  const wanted = requested.filter((s) => OAUTH_SCOPES.includes(s));
  return wanted.length ? wanted : requested.length ? ["tasks:read"] : [...OAUTH_SCOPES];
};

export const consentRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

const NOT_ALLOWED = "This app's return address is not allowed.";

consentRoutes.get("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const request = await oauth.parseAuthRequest(c.req.raw);
    if (!redirectAllowed(request.redirectUri)) return text(NOT_ALLOWED, 400);
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    return new Response(page(details, consent.handle), { headers: applyPageHeaders(consent.headers) });
  } catch (error) {
    return failure(error);
  }
});

consentRoutes.post("/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    // Client metadata documents skip /register, so the allowlist is enforced here too,
    // before the form is read or the passphrase is checked.
    const request = await oauth.parseAuthRequest(c.req.raw);
    if (!redirectAllowed(request.redirectUri)) return text(NOT_ALLOWED, 400);
    const form = await c.req.raw.formData();
    const handle = String(form.get("handle") ?? "");

    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    if (!c.env.OWNER_PASSPHRASE) {
      const details = await oauth.describeConsent(request);
      return new Response(page(details, handle, "Sign-in isn't set up on this server."), { status: 503, headers: applyPageHeaders(new Headers()) });
    }

    // The passphrase is checked before the consent handle is spent.
    const result = await checkPassphrase(c.env.OAUTH_KV, String(form.get("passphrase") ?? ""), c.env.OWNER_PASSPHRASE);
    if (result !== "ok") {
      const details = await oauth.describeConsent(request);
      const message = result === "locked" ? "Too many attempts. Try again in 15 minutes." : "That passphrase is not right.";
      return new Response(page(details, handle, message), { status: result === "locked" ? 429 : 401, headers: applyPageHeaders(new Headers()) });
    }

    const scope = grantable(request.scope);
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    if (!redirectAllowed(approved.request.redirectUri)) return text(NOT_ALLOWED, 400);
    const details = await oauth.describeConsent(approved.request);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: "owner",
      metadata: { label: details.clientName },
      scope,
      props: { kind: "oauth", scopes: [scope.includes("tasks:write") ? "write" : "read"] },
    });
    approved.headers.set("Location", redirectTo);
    approved.headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return failure(error);
  }
});

function failure(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo && redirectAllowed(error.redirectTo)) {
    return new Response(null, { status: 302, headers: { Location: error.redirectTo, "Cache-Control": "no-store" } });
  }
  if (error instanceof AuthorizationError) return text(error.description || "This request could not be completed. Start again from the app.", 400);
  if (error instanceof CimdFetchError) return text("This app could not be verified.", 400);
  throw error;
}
