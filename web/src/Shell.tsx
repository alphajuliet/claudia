import { useSession } from "./session/SessionProvider";

export function Shell() {
  const { state, signOut } = useSession();
  if (state.status !== "signedIn") return null;
  return (
    <main>
      <h1>Claudia</h1>
      <p>Signed in as {state.me.name} ({state.me.scopes.join(", ")})</p>
      <button onClick={() => signOut()}>Sign out</button>
    </main>
  );
}
