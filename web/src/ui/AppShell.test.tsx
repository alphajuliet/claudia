import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Filter, Folder, List } from "@claudia/shared";
import { SessionProvider } from "../session/SessionProvider";
import { tokenStore } from "../session/store";
import { AppShell } from "./AppShell";

const me = { name: "laptop", scopes: ["write"], expiresAt: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const at = "2026-10-31T00:00:00.000Z";

const work: Folder = { id: "01JC0000000000000000000001", name: "Acme", parentId: null, context: "work", position: "a0", createdAt: at, updatedAt: at };
const personal: Folder = { id: "01JC0000000000000000000002", name: "Life", parentId: null, context: "personal", position: "a1", createdAt: at, updatedAt: at };
const list = (id: string, name: string, folderId: string | null, position = "a0"): List =>
  ({ id, name, folderId, position, archivedAt: null, createdAt: at, updatedAt: at });
const inbox = list("01JA0000000000000000000001", "Inbox", null);
const projects = list("01JA0000000000000000000002", "Projects", work.id);
const garden = list("01JA0000000000000000000003", "Garden", personal.id);
const filter: Filter = { id: "01JD0000000000000000000001", name: "Errands", query: "label=errand", position: "a0", createdAt: at, updatedAt: at };

function stubApi(data: { lists?: List[]; filters?: Filter[] } = {}) {
  const bodies: Record<string, unknown> = {
    "/api/me": me,
    "/api/folders": [work, personal],
    "/api/lists": data.lists ?? [inbox, projects, garden],
    "/api/filters": data.filters ?? [filter],
    "/api/settings": {},
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => (path in bodies ? json(bodies[path]) : json([]))));
}

function renderShell(path = "/inbox") {
  tokenStore.set("cl_test");
  const location = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Router hook={location.hook}>
          <AppShell />
        </Router>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { ...view, location };
}

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));

describe("AppShell", () => {
  it("shows the views, saved filters and the folder tree", async () => {
    stubApi();
    renderShell();
    expect(await sidebar().findByRole("link", { name: "Projects" })).toBeTruthy();
    for (const name of ["Inbox", "Today", "Next", "WIP", "Waiting", "Someday", "Errands", "Garden"])
      expect(sidebar().getByRole("link", { name })).toBeTruthy();
    expect(sidebar().getByText("Acme")).toBeTruthy();
    expect(sidebar().getByText("Life")).toBeTruthy();
    expect(sidebar().getByText("laptop")).toBeTruthy();
    expect(sidebar().getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("marks the current route's link and redirects / to the Inbox", async () => {
    stubApi();
    renderShell("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Inbox" })).toBeTruthy();
    expect((await sidebar().findByRole("link", { name: "Inbox" })).getAttribute("aria-current")).toBe("page");
    expect(sidebar().getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
  });

  it("hides Inbox when there is no list called Inbox", async () => {
    stubApi({ lists: [projects] });
    renderShell("/today");
    expect(await sidebar().findByRole("link", { name: "Projects" })).toBeTruthy();
    expect(sidebar().queryByRole("link", { name: "Inbox" })).toBeNull();
  });

  it("narrows the tree to the chosen context and remembers it", async () => {
    stubApi();
    const first = renderShell();
    await sidebar().findByRole("link", { name: "Garden" });
    await userEvent.click(sidebar().getByRole("button", { name: "Work" }));
    expect(sidebar().queryByRole("link", { name: "Garden" })).toBeNull();
    expect(sidebar().getByRole("link", { name: "Projects" })).toBeTruthy();
    expect(localStorage.getItem("claudia.context")).toBe("work");

    first.unmount();
    renderShell();
    expect(await sidebar().findByRole("link", { name: "Projects" })).toBeTruthy();
    expect(sidebar().queryByRole("link", { name: "Garden" })).toBeNull();
    expect(sidebar().getByRole("button", { name: "Work" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("navigates to a list from its link", async () => {
    stubApi();
    const { location } = renderShell();
    await userEvent.click(await sidebar().findByRole("link", { name: "Garden" }));
    expect(location.history.at(-1)).toBe(`/list/${garden.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Garden" })).toBeTruthy();
    expect(sidebar().getByRole("link", { name: "Garden" }).getAttribute("aria-current")).toBe("page");
  });

  it("navigates to a saved filter from its link", async () => {
    stubApi();
    const { location } = renderShell();
    await userEvent.click(await sidebar().findByRole("link", { name: "Errands" }));
    expect(location.history.at(-1)).toBe(`/filter/${filter.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Errands" })).toBeTruthy();
  });

  it("shows Not found for an unknown route, with a way back", async () => {
    stubApi();
    renderShell("/nowhere/at/all");
    expect(await screen.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Go to Inbox" })).toBeTruthy();
  });

  it("treats an unknown view name as not found", async () => {
    stubApi();
    renderShell("/later");
    expect(await screen.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy();
  });

  it("opens the sidebar drawer from Menu and closes it when a link is chosen", async () => {
    stubApi();
    const { container } = renderShell();
    const shell = container.querySelector(".shell")!;
    expect(shell.classList.contains("drawer-open")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(shell.classList.contains("drawer-open")).toBe(true);
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(sidebar().getByRole("link", { name: "Today" }));
    expect(shell.classList.contains("drawer-open")).toBe(false);
  });
});
