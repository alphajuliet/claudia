import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder } from "@claudia/shared";
import { at, errands, garden, personal, projects, renderAt, sentBodies, stubApi, task, work } from "./testApi";

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));
const menuButton = (name: string) => sidebar().getByRole("button", { name });
const menu = () => screen.getByRole("menu");
const item = (name: RegExp | string) => within(menu()).getByRole("menuitem", { name });
const listNames = () => [...document.querySelectorAll("[data-list-row] .nav-name")].map((n) => n.textContent);
const folderNames = () => [...document.querySelectorAll("[data-folder-row] .folder-name")].map((n) => n.textContent);
const toast = () => screen.getByRole("status");

async function shown(path = "/next", opts: Parameters<typeof stubApi>[1] = {}, tasks: Parameters<typeof stubApi>[0] = []) {
  const fetchMock = stubApi(tasks, opts);
  const view = renderAt(path);
  await waitFor(() => expect(listNames()).toEqual(["Errands", "Projects", "Garden"]));
  return { fetchMock, ...view };
}

describe("the folder menu", () => {
  it("offers New list, New folder, Rename and Delete", async () => {
    await shown();
    await userEvent.click(menuButton("Acme folder menu"));
    expect(within(menu()).getAllByRole("menuitem").map((m) => m.firstChild?.textContent)).toEqual(["New list", "New folder", "Rename", "Delete"]);
    // Opening it leaves the folder open.
    expect(sidebar().getByText("Acme").closest("details")!.open).toBe(true);
  });

  it("makes a list in the folder from a name typed in place, and opens it", async () => {
    const { fetchMock, location } = await shown();
    await userEvent.click(menuButton("Acme folder menu"));
    await userEvent.click(item("New list"));
    const field = sidebar().getByRole("textbox", { name: "New list name" });
    expect(document.activeElement).toBe(field);
    // Inside Acme, after its lists.
    expect(field.closest("details")).toBe(sidebar().getByText("Acme").closest("details"));
    await userEvent.type(field, "Clients{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/lists")).toEqual([{ name: "Clients", folderId: work.id }]);
    await waitFor(() => expect(listNames()).toEqual(["Errands", "Projects", "Clients", "Garden"]));
    await waitFor(() => expect(location.history?.at(-1)).toMatch(/^\/list\/01JF/));
  });

  it("makes a subfolder, which takes the folder's context", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Life folder menu"));
    await userEvent.click(item("New folder"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New folder name" }), "Garden jobs{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/folders")).toEqual([{ name: "Garden jobs", parentId: personal.id }]);
    await waitFor(() => expect(folderNames()).toEqual(["Acme", "Life", "Garden jobs"]));
  });

  it("makes nothing on Escape or with no name", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Acme folder menu"));
    await userEvent.click(item("New list"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New list name" }), "Clie{Escape}");
    expect(sidebar().queryByRole("textbox", { name: "New list name" })).toBeNull();
    await userEvent.click(menuButton("Acme folder menu"));
    await userEvent.click(item("New folder"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New folder name" }), "  {Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/lists")).toEqual([]);
    expect(sentBodies(fetchMock, "POST", "/api/folders")).toEqual([]);
  });

  it("renames the folder", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Acme folder menu"));
    await userEvent.click(item("Rename"));
    const field = sidebar().getByRole("textbox", { name: "Folder name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Acme Ltd{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/folders/${work.id}`)).toEqual([{ name: "Acme Ltd" }]);
  });

  it("deletes an empty folder, and says why one with lists in it can't be", async () => {
    const empty: Folder = { id: "01JC0000000000000000000003", name: "Spare", parentId: null, context: "home", position: "a2", createdAt: at, updatedAt: at };
    const { fetchMock } = await shown("/next", { folders: [work, personal, empty] });
    await userEvent.click(menuButton("Acme folder menu"));
    const refused = item(/^Delete/);
    expect(refused.getAttribute("aria-disabled")).toBe("true");
    expect(refused.textContent).toContain("Move or delete its lists and folders first");
    await userEvent.click(refused);
    expect(sentBodies(fetchMock, "DELETE", `/api/folders/${work.id}`)).toEqual([]);
    await userEvent.keyboard("{Escape}");

    await userEvent.click(menuButton("Spare folder menu"));
    await userEvent.click(item("Delete"));
    await waitFor(() => expect(folderNames()).toEqual(["Acme", "Life"]));
    expect(fetchMock.mock.calls.some(([p, init]) => p === `/api/folders/${empty.id}` && init?.method === "DELETE")).toBe(true);
    await waitFor(() => expect(toast().textContent).toContain("Deleted “Spare”"));
  });
});

describe("the list menu", () => {
  it("archives a list, with Undo", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Errands list menu"));
    await userEvent.click(item("Archive"));
    await waitFor(() => expect(listNames()).toEqual(["Projects", "Garden"]));
    expect(sentBodies(fetchMock, "PATCH", `/api/lists/${errands.id}`)).toEqual([{ archived: true }]);
    await waitFor(() => expect(toast().textContent).toContain("Archived “Errands”"));
    await userEvent.click(within(toast()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(listNames()).toEqual(["Errands", "Projects", "Garden"]));
    expect(sentBodies(fetchMock, "PATCH", `/api/lists/${errands.id}`).at(-1)).toEqual({ archived: false });
  });

  it("deletes an empty list, leaving it if it was open", async () => {
    const { fetchMock, location } = await shown(`/list/${errands.id}`);
    await userEvent.click(menuButton("Errands list menu"));
    await userEvent.click(item("Delete"));
    await waitFor(() => expect(listNames()).toEqual(["Projects", "Garden"]));
    expect(fetchMock.mock.calls.some(([p, init]) => p === `/api/lists/${errands.id}` && init?.method === "DELETE")).toBe(true);
    // Home, which opens on the Dashboard.
    await waitFor(() => expect(location.history?.at(-1)).toBe("/dashboard"));
  });

  it("won't delete a list with open tasks, and shows the server's refusal for completed ones", async () => {
    const tasks = [task({ title: "Weed", listId: garden.id }), task({ title: "Done", listId: projects.id, completedAt: at })];
    await shown("/next", {}, tasks);
    await userEvent.click(menuButton("Garden list menu"));
    await waitFor(() => expect(item(/^Delete/).textContent).toContain("Move or delete its tasks first"));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(menuButton("Projects list menu"));
    await userEvent.click(item("Delete"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Move or delete the list's tasks first"));
    await waitFor(() => expect(listNames()).toEqual(["Errands", "Projects", "Garden"]));
  });
});

describe("the Lists heading menu", () => {
  it("makes a list outside any folder", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Lists menu"));
    await userEvent.click(item("New list"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New list name" }), "Reading{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/lists")).toEqual([{ name: "Reading", folderId: null }]);
  });

  it("asks which context a top-level folder is for under All", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(menuButton("Lists menu"));
    expect(within(menu()).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["New list", "New Work folder", "New Personal folder", "New Home folder"]);
    await userEvent.click(item("New Home folder"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New folder name" }), "House{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/folders")).toEqual([{ name: "House", parentId: null, context: "home" }]);
    await waitFor(() => expect(folderNames()).toEqual(["Acme", "Life", "House"]));
  });

  it("uses the context shown otherwise", async () => {
    const { fetchMock } = await shown();
    await userEvent.click(sidebar().getByRole("button", { name: "Work" }));
    await userEvent.click(menuButton("Lists menu"));
    await userEvent.click(item("New folder"));
    await userEvent.type(sidebar().getByRole("textbox", { name: "New folder name" }), "Clients{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/folders")).toEqual([{ name: "Clients", parentId: null, context: "work" }]);
  });
});

describe("the menu and the keyboard", () => {
  it("takes focus, moves with the arrows, and gives it back on Escape without running the app's keys", async () => {
    const { location } = await shown();
    const button = menuButton("Acme folder menu");
    await userEvent.click(button);
    expect(document.activeElement).toBe(item("New list"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("New folder"));
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(item("Rename"));
    // g i would go to the Inbox.
    await userEvent.keyboard("gi");
    expect(location.history?.at(-1)).toBe("/next");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on a click elsewhere", async () => {
    await shown();
    await userEvent.click(menuButton("Errands list menu"));
    expect(menu()).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

/** Rows in order: Lists, Errands, Acme, Projects, Life, Garden; each 30 high and 200 wide, from top 100. */
const yOf = (i: number, part = 0.5) => 100 + 30 * i + 30 * part;
const mouse = { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0 };
function drag(el: Element, from: number, y: number) {
  fireEvent.pointerDown(el, { ...mouse, clientX: 50, clientY: yOf(from) });
  fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: yOf(from) + 8 });
  fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: y });
  fireEvent.pointerUp(document.body, { ...mouse, clientX: 50, clientY: y });
}
const folderMoves = (fetchMock: ReturnType<typeof stubApi>, f: Folder) => sentBodies(fetchMock, "POST", `/api/folders/${f.id}/move`);

describe("dragging a folder in the sidebar", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("sidebar-scroll")) return { top: 0, bottom: 800, left: 0, right: 200, width: 200, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const i = [...document.querySelectorAll("[data-list-row], [data-folder-row]")].indexOf(this);
      const top = i < 0 ? 0 : 100 + 30 * i;
      const height = i < 0 ? 0 : 30;
      return { top, bottom: top + height, left: 0, right: i < 0 ? 0 : 200, width: i < 0 ? 0 : 200, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const name = (folder: string) => sidebar().getByText(folder, { selector: ".folder-name" });

  it("moves it into a folder dropped on, which lights up, taking that folder's context", async () => {
    const { fetchMock } = await shown();
    const life = name("Life");
    fireEvent.pointerDown(life, { ...mouse, clientX: 50, clientY: yOf(4) });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: yOf(4) + 8 });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 50, clientY: yOf(2) });
    expect(name("Acme").closest("summary")!.hasAttribute("data-drop-target")).toBe(true);
    fireEvent.pointerUp(document.body, { ...mouse, clientX: 50, clientY: yOf(2) });
    await waitFor(() => expect(folderMoves(fetchMock, personal)).toEqual([{ parentId: work.id }]));
    // Life and its list now sit inside Acme.
    await waitFor(() => expect(name("Life").closest("details")!.parentElement!.closest("details")).toBe(name("Acme").closest("details")));
    expect(listNames()).toEqual(["Errands", "Projects", "Garden"]);
  });

  it("moves it before a folder at the top quarter of its name, and to the top level on the Lists heading", async () => {
    const { fetchMock } = await shown();
    drag(name("Life"), 4, yOf(2, 0.1));
    await waitFor(() => expect(folderMoves(fetchMock, personal)).toEqual([{ parentId: null, beforeId: work.id }]));
    await waitFor(() => expect(folderNames()).toEqual(["Life", "Acme"]));
    drag(name("Acme"), 4, yOf(0));
    await waitFor(() => expect(folderMoves(fetchMock, work)).toEqual([{ parentId: null, beforeId: personal.id }]));
  });

  it("sends nothing for a drop on itself or where it already is", async () => {
    const { fetchMock } = await shown();
    drag(name("Life"), 4, yOf(4));
    drag(name("Life"), 4, yOf(5));
    drag(name("Acme"), 2, yOf(4, 0.1));
    await new Promise((r) => setTimeout(r));
    expect(folderMoves(fetchMock, personal)).toEqual([]);
    expect(folderMoves(fetchMock, work)).toEqual([]);
  });

  it("leaves the press alone on the menu button", async () => {
    const { fetchMock } = await shown();
    drag(menuButton("Life folder menu"), 4, yOf(2));
    await new Promise((r) => setTimeout(r));
    expect(folderMoves(fetchMock, personal)).toEqual([]);
  });
});

