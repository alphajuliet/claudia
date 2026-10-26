import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "@claudia/shared";
import { ApiNetworkError, ApiUnauthorized, apiFetch, fetchMe } from "./api";
import { tokenStore } from "./store";

export const INVALID_TOKEN = "That token isn't valid or has expired.";
export const UNREACHABLE = "Can't reach Claudia. Check your connection and try again.";

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "offline" }
  | { status: "signedIn"; token: string; me: Me };

interface Session {
  state: SessionState;
  /** Checks the token, stores it if good. Resolves to an error message, or null on success. */
  signIn(token: string): Promise<string | null>;
  signOut(notice?: string): void;
  retry(): void;
  /** Authenticated fetch. A 401 signs out. */
  api(path: string, init?: RequestInit): Promise<Response>;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(Ctx);
  if (!session) throw new Error("useSession needs a SessionProvider");
  return session;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>(() => (tokenStore.get() ? { status: "loading" } : { status: "signedOut" }));
  const [attempt, setAttempt] = useState(0);

  const signOut = useCallback(
    (notice?: string) => {
      tokenStore.clear();
      queryClient.clear();
      setState({ status: "signedOut", notice });
    },
    [queryClient],
  );

  // Check a stored token on load, and again on retry.
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    let live = true;
    fetchMe(token)
      .then((me) => live && setState({ status: "signedIn", token, me }))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiUnauthorized) signOut(INVALID_TOKEN);
        else setState({ status: "offline" });
      });
    return () => {
      live = false;
    };
  }, [attempt, signOut]);

  const signIn = useCallback(async (raw: string) => {
    const token = raw.trim();
    try {
      const me = await fetchMe(token);
      tokenStore.set(token);
      setState({ status: "signedIn", token, me });
      return null;
    } catch (e) {
      if (e instanceof ApiUnauthorized) return INVALID_TOKEN;
      if (e instanceof ApiNetworkError) return UNREACHABLE;
      return "Something went wrong. Try again.";
    }
  }, []);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const token = state.status === "signedIn" ? state.token : null;
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!token) throw new Error("Not signed in");
      try {
        return await apiFetch(token, path, init);
      } catch (e) {
        if (e instanceof ApiUnauthorized) signOut(INVALID_TOKEN);
        throw e;
      }
    },
    [token, signOut],
  );

  const value = useMemo(() => ({ state, signIn, signOut, retry, api }), [state, signIn, signOut, retry, api]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
