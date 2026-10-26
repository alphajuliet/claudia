import type { ReactNode } from "react";
import { Shell } from "./Shell";
import { SignIn } from "./SignIn";
import { SessionProvider, useSession } from "./session/SessionProvider";

function Gate() {
  const { state, retry } = useSession();
  switch (state.status) {
    case "loading":
      return <main><p>Checking…</p></main>;
    case "offline":
      return (
        <main>
          <h1>Claudia</h1>
          <p>Can't reach Claudia. Your token is still saved.</p>
          <button onClick={retry}>Try again</button>
        </main>
      );
    case "signedOut":
      return <SignIn notice={state.notice} />;
    case "signedIn":
      return <Shell />;
  }
}

export function App({ children }: { children?: ReactNode }) {
  return (
    <SessionProvider>
      <Gate />
      {children}
    </SessionProvider>
  );
}
