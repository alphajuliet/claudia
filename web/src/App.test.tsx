import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Gate } from "./App";
import { SessionProvider, useSession } from "./session/SessionProvider";
import { tokenStore } from "./session/store";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Answers /api/me with `me` and the shell's own reads with empty results. */
const signedInApi = () => vi.fn(async (path: string, _init?: RequestInit) => json(path === "/api/me" ? me : path === "/api/settings" ? {} : []));

/** Waits for the shell, which shows the token's name in the sidebar footer. */
async function findSignedInAs(name: string) {
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  return within(sidebar).findByText(name);
}

afterEach(() => vi.restoreAllMocks());

function renderApp() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

function renderWithProbe(probe: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider>
        <Gate />
        {probe}
      </SessionProvider>
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
    const fetchMock = signedInApi();
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await signInWith("  cl_good  ");
    expect(await findSignedInAs("laptop")).toBeTruthy();
    expect(screen.getByText(/write/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_good");
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer cl_good");
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
    vi.stubGlobal("fetch", signedInApi());
    renderApp();
    expect(await findSignedInAs("laptop")).toBeTruthy();
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
    const fetchMock = signedInApi().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_stored");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await findSignedInAs("laptop")).toBeTruthy();
  });

  it("shows the form on retry when the token was cleared meanwhile", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderApp();
    expect(await screen.findByText(/Can't reach Claudia/)).toBeTruthy();
    localStorage.clear();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("API token")).toBeTruthy();
  });
});

describe("signed in", () => {
  it("keeps the signed-in token in memory when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.stubGlobal("fetch", signedInApi());
    renderApp();
    await signInWith("cl_good");
    expect(await findSignedInAs("laptop")).toBeTruthy();
  });

  it("signs out and forgets the token", async () => {
    tokenStore.set("cl_stored");
    vi.stubGlobal("fetch", signedInApi());
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.getByLabelText("API token")).toBeTruthy();
    expect(tokenStore.get()).toBeNull();
  });

  it("signs out when a later call returns 401", async () => {
    tokenStore.set("cl_stored");
    const shellApi = signedInApi();
    vi.stubGlobal("fetch", vi.fn(async (path: string) => (path === "/api/probe" ? json({ error: {} }, 401) : shellApi(path))));
    function Probe() {
      const { api } = useSession();
      return <button onClick={() => api("/api/probe").catch(() => {})}>probe</button>;
    }
    renderWithProbe(<Probe />);
    await findSignedInAs("laptop");
    await userEvent.click(screen.getByRole("button", { name: "probe" }));
    await waitFor(() => expect(screen.getByText("That token isn't valid or has expired.")).toBeTruthy());
    expect(tokenStore.get()).toBeNull();
  });

  it("ignores a late 401 from a previous session", async () => {
    let finishOld!: (res: Response) => void;
    const fetchMock = vi.fn((path: string) =>
      path === "/api/slow" ? new Promise<Response>((resolve) => { finishOld = resolve; }) : signedInApi()(path),
    );
    vi.stubGlobal("fetch", fetchMock);
    function Probe() {
      const { api } = useSession();
      return <button onClick={() => api("/api/slow").catch(() => {})}>probe</button>;
    }
    renderWithProbe(<Probe />);
    await signInWith("cl_a");
    await userEvent.click(await screen.findByRole("button", { name: "probe" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await signInWith("cl_b");
    expect(await findSignedInAs("laptop")).toBeTruthy();
    finishOld(json({ error: {} }, 401));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(screen.getByRole("navigation", { name: "Sidebar" })).getByText("laptop")).toBeTruthy();
    expect(tokenStore.get()).toBe("cl_b");
  });
});
