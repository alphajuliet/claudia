import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useSession } from "./session/SessionProvider";
import { tokenStore } from "./session/store";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function renderApp(extra?: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <App>{extra}</App>
    </QueryClientProvider>,
  );
}

async function signInWith(token: string) {
  await userEvent.type(screen.getByLabelText("API token"), token);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("sign-in", () => {
  it("shows the form when there is no stored token", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderApp();
    expect(screen.getByLabelText("API token")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks a pasted token, stores it and shows who is signed in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(me));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await signInWith("  cl_good  ");
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
    expect(screen.getByText(/write/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_good");
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer cl_good");
  });

  it("does not store a rejected token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: {} }, 401)));
    renderApp();
    await signInWith("cl_bad");
    expect(await screen.findByText("That token isn't valid or has expired.")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("says so when the server cannot be reached and does not store the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();
    await signInWith("cl_x");
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });
});

describe("stored token", () => {
  it("signs in on load when the token is still good", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(me)));
    renderApp();
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
  });

  it("clears a rejected token on load and says why", async () => {
    tokenStore.set("cl_revoked");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: {} }, 401)));
    renderApp();
    expect(await screen.findByText("That token isn't valid or has expired.")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("keeps the token when offline and recovers on retry", async () => {
    tokenStore.set("cl_stored");
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(json(me));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_stored");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Signed in as laptop/)).toBeTruthy();
  });
});

describe("signed in", () => {
  it("signs out and forgets the token", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(me)));
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.getByLabelText("API token")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("signs out when a later call returns 401", async () => {
    tokenStore.set("cl_stored");
    const fetchMock = vi.fn().mockResolvedValueOnce(json(me)).mockResolvedValue(json({ error: {} }, 401));
    vi.stubGlobal("fetch", fetchMock);
    function Probe() {
      const { api } = useSession();
      return <button onClick={() => api("/api/folders").catch(() => {})}>probe</button>;
    }
    renderApp(<Probe />);
    await userEvent.click(await screen.findByRole("button", { name: "probe" }));
    await waitFor(() => expect(screen.getByText("That token isn't valid or has expired.")).toBeTruthy());
    expect(tokenStore.get()).toBeNull();
  });
});
