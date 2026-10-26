import { useState, type FormEvent } from "react";
import { useSession } from "./session/SessionProvider";

export function SignIn({ notice }: { notice?: string }) {
  const { signIn } = useSession();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(await signIn(token));
    setBusy(false);
  }

  const message = error ?? notice;
  return (
    <main>
      <h1>Claudia</h1>
      <form onSubmit={submit}>
        <label htmlFor="token">API token</label>
        <input id="token" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
        {message && <p role="alert">{message}</p>}
        <button type="submit" disabled={busy}>Sign in</button>
      </form>
    </main>
  );
}
