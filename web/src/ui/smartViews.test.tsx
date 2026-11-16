import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { at, garden, inbox, main, renderAt, sentBodies, smartView, stubApi, task, work } from "./testApi";

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));
const menu = () => screen.getByRole("menu");
const item = (name: RegExp | string) => within(menu()).getByRole("menuitem", { name });
const smartNames = () => [...document.querySelectorAll("[data-filter-row] .nav-name")].map((n) => n.textContent);

const soon = smartView({ id: "01JD0000000000000000000001", name: "Soon", query: "beans", position: "a0" });
const desk = smartView({ id: "01JD0000000000000000000002", name: "Desk", query: "#next", folderId: work.id, position: "a0" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("smart views in the sidebar", () => {
  it("sit under Smart views, or in their folder after its lists", async () => {
    stubApi([], { filters: [soon, desk] });
    renderAt("/next");
    await waitFor(() => expect(smartNames()).toEqual(["Soon", "Desk"]));
    expect(sidebar().getByRole("heading", { name: "Smart views" })).toBeTruthy();
    expect(sidebar().getByRole("link", { name: "Desk" }).closest("details")).toBe(sidebar().getByText("Acme").closest("details"));
  });

  it("collapse under their heading, showing how many, and stay collapsed on this device", async () => {
    stubApi([], { filters: [soon, desk] });
    const { unmount } = renderAt("/next");
    await waitFor(() => expect(smartNames()).toEqual(["Soon", "Desk"]));
    const toggle = sidebar().getByRole("button", { name: "Smart views" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle);
    // Only those outside folders fold away; Desk stays in its folder.
    expect(smartNames()).toEqual(["Desk"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Smart views1");
    unmount();

    renderAt("/next");
    await waitFor(() => expect(sidebar().getByRole("button", { name: /Smart views/ }).getAttribute("aria-expanded")).toBe("false"));
    await userEvent.click(sidebar().getByRole("button", { name: /Smart views/ }));
    expect(smartNames()).toEqual(["Soon", "Desk"]);
    localStorage.removeItem("claudia.smartViewsOpen");
  });

  it("rename and delete from their menu, and keep their folder from being deleted", async () => {
    const fetchMock = stubApi([], { filters: [soon, desk] });
    const { location } = renderAt(`/filter/${soon.id}`);
    await waitFor(() => expect(smartNames()).toEqual(["Soon", "Desk"]));

    await userEvent.click(sidebar().getByRole("button", { name: "Acme folder menu" }));
    expect(item(/^Delete/).getAttribute("aria-disabled")).toBe("true");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(sidebar().getByRole("button", { name: "Desk smart view menu" }));
    await userEvent.click(item("Rename"));
    const field = sidebar().getByRole("textbox", { name: "Smart view name" });
    await userEvent.clear(field);
    await userEvent.type(field, "At the desk{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/filters/${desk.id}`)).toEqual([{ name: "At the desk" }]);
    await waitFor(() => expect(smartNames()).toEqual(["Soon", "At the desk"]));

    await userEvent.click(sidebar().getByRole("button", { name: "Soon smart view menu" }));
    await userEvent.click(item("Delete"));
    await waitFor(() => expect(smartNames()).toEqual(["At the desk"]));
    expect(fetchMock.mock.calls.some(([p, init]) => p === `/api/filters/${soon.id}` && init?.method === "DELETE")).toBe(true);
    // It was open, so the screen goes too.
    await waitFor(() => expect(location.history?.at(-1)).not.toBe(`/filter/${soon.id}`));
  });
});

describe("dragging a smart view", () => {
  // Rows in order, each 30 high from top 100: Smart views, Soon, Lists, Errands, Acme, Projects, Desk, Life, Garden.
  const ROWS = "[data-filter-heading], [data-filter-row], [data-list-row], [data-folder-row]";
  const yOf = (i: number, part = 0.5) => 100 + 30 * i + 30 * part;
  const mouse = { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0 };
  function drag(el: Element, from: number, y: number) {
    fireEvent.pointerDown(el, { ...mouse, clientX: 50, clientY: yOf(from) });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: yOf(from) + 8 });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: y });
    fireEvent.pointerUp(document.body, { ...mouse, clientX: 50, clientY: y });
  }
  async function shown() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("sidebar-scroll")) return { top: 0, bottom: 800, left: 0, right: 200, width: 200, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const i = [...document.querySelectorAll(ROWS)].indexOf(this);
      const top = i < 0 ? 0 : 100 + 30 * i;
      const height = i < 0 ? 0 : 30;
      return { top, bottom: top + height, left: 0, right: i < 0 ? 0 : 200, width: i < 0 ? 0 : 200, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const fetchMock = stubApi([], { filters: [soon, desk] });
    renderAt("/next");
    await waitFor(() => expect(smartNames()).toEqual(["Soon", "Desk"]));
    return fetchMock;
  }
  const link = (name: string) => sidebar().getByRole("link", { name });

  it("puts it in a folder dropped on, and the sidebar shows it there at once", async () => {
    const fetchMock = await shown();
    drag(link("Soon"), 1, yOf(4));
    await waitFor(() => expect(sentBodies(fetchMock, "POST", `/api/filters/${soon.id}/move`)).toEqual([{ folderId: work.id }]));
    expect(sidebar().getByRole("link", { name: "Soon" }).closest("details")).toBe(sidebar().getByText("Acme").closest("details"));
  });

  it("takes it out of a folder onto the Smart views heading, or beside another", async () => {
    const fetchMock = await shown();
    drag(link("Desk"), 6, yOf(1, 0.25));
    await waitFor(() => expect(sentBodies(fetchMock, "POST", `/api/filters/${desk.id}/move`)).toEqual([{ folderId: null, beforeId: soon.id }]));
    await waitFor(() => expect(smartNames()).toEqual(["Desk", "Soon"]));
  });

  it("sends nothing for a drop where it already is", async () => {
    const fetchMock = await shown();
    drag(link("Soon"), 1, yOf(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(sentBodies(fetchMock, "POST", `/api/filters/${soon.id}/move`)).toEqual([]);
  });
});

describe("a smart view's screen", () => {
  const tasks = () => [
    task({ title: "Water the beans", listId: garden.id }),
    task({ title: "Pick the beans", listId: garden.id, completedAt: at }),
    task({ title: "Water bill", listId: inbox.id }),
  ];

  it("shows its search, and saves or reverts changes", async () => {
    const fetchMock = stubApi(tasks(), { filters: [soon] });
    renderAt(`/filter/${soon.id}`);
    expect(await main().findByText("Water the beans")).toBeTruthy();
    const field = main().getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    expect(field.value).toBe("beans");
    // The tasks have the keyboard, not the field.
    expect(document.activeElement).not.toBe(field);
    expect(main().queryByRole("button", { name: "Save" })).toBeNull();

    await userEvent.clear(field);
    await userEvent.type(field, "water");
    expect(await main().findByText("Water bill")).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(field.value).toBe("beans"));
    await waitFor(() => expect(main().queryByText("Water bill")).toBeNull());
    expect(main().queryByRole("button", { name: "Save" })).toBeNull();

    await userEvent.clear(field);
    await userEvent.type(field, "water sort:title");
    await userEvent.selectOptions(main().getByRole("combobox", { name: "Group" }), "none");
    await userEvent.click(main().getByRole("button", { name: "Show completed" }));
    await userEvent.click(main().getByRole("button", { name: "Save" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/filters/${soon.id}`)).toEqual([
      { query: "water sort:title", sort: null, group: "none", display: { showCompleted: true } },
    ]);
    // Saved, the sort: moves out of the search, and there's nothing left to save.
    await waitFor(() => expect(field.value).toBe("water"));
    await waitFor(() => expect(main().queryByRole("button", { name: "Save" })).toBeNull());
    expect((main().getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value).toBe("title");
  });

  it("opens with its own Show completed, leaving the browser's alone", async () => {
    stubApi(tasks(), { filters: [{ ...soon, display: { showCompleted: true } }] });
    const { unmount } = renderAt(`/filter/${soon.id}`);
    expect(await main().findByText("Pick the beans")).toBeTruthy();
    expect(main().getByRole("button", { name: "Hide completed" })).toBeTruthy();
    unmount();
    renderAt("/search?q=beans");
    expect(await main().findByText("Water the beans")).toBeTruthy();
    expect(main().queryByText("Pick the beans")).toBeNull();
  });

  it("renames from its title and deletes from its menu", async () => {
    const fetchMock = stubApi(tasks(), { filters: [soon] });
    const { location } = renderAt(`/filter/${soon.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Soon" }));
    const name = main().getByRole("textbox", { name: "Smart view name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Beans{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/filters/${soon.id}`)).toEqual([{ name: "Beans" }]);
    expect(await main().findByRole("heading", { level: 1, name: "Beans" })).toBeTruthy();

    await userEvent.click(main().getByRole("button", { name: "Beans smart view menu" }));
    await userEvent.click(item("Delete"));
    await waitFor(() => expect(location.history?.at(-1)).toBe("/dashboard"));
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("is Not found once it's gone", async () => {
    stubApi([], { filters: [] });
    renderAt(`/filter/${soon.id}`);
    expect(await screen.findByRole("heading", { name: "Not found" })).toBeTruthy();
  });
});

describe("saving a search as a smart view", () => {
  it("asks for a name, saves the search, sort, grouping and Show completed, and opens it", async () => {
    const fetchMock = stubApi([task({ title: "Water the beans", listId: garden.id })]);
    const { location } = renderAt("/search?q=beans&group=due");
    expect(await main().findByText("Water the beans")).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Save as smart view" }));
    await userEvent.type(main().getByRole("textbox", { name: "Smart view name" }), "Beans{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/filters")).toEqual([{ name: "Beans", query: "beans", sort: null, group: "due", display: {} }]);
    await waitFor(() => expect(location.history?.at(-1)).toMatch(/^\/filter\/01JG/));
    expect(await main().findByRole("heading", { level: 1, name: "Beans" })).toBeTruthy();
    await waitFor(() => expect(smartNames()).toEqual(["Beans"]));
  });

  it("isn't offered with no search or one with a problem, and Escape cancels", async () => {
    const fetchMock = stubApi([task({ title: "Water the beans", listId: garden.id })]);
    renderAt("/search");
    const field = await main().findByRole("searchbox", { name: "Search" });
    expect(main().queryByRole("button", { name: "Save as smart view" })).toBeNull();
    await userEvent.type(field, "colour:red");
    await main().findByRole("alert");
    expect(main().queryByRole("button", { name: "Save as smart view" })).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, "beans");
    await userEvent.click(await main().findByRole("button", { name: "Save as smart view" }));
    await userEvent.type(main().getByRole("textbox", { name: "Smart view name" }), "Be{Escape}");
    expect(main().queryByRole("textbox", { name: "Smart view name" })).toBeNull();
    expect(sentBodies(fetchMock, "POST", "/api/filters")).toEqual([]);
  });
});
