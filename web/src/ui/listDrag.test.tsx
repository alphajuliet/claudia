import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { List } from "@claudia/shared";
import { errands, garden, inbox, personal, projects, renderAt, sentBodies, stubApi, work } from "./testApi";

const shed: List = { ...errands, id: "01JA0000000000000000000009", name: "Shed", position: "a1" };
const lists = [inbox, errands, shed, projects, garden];

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));
const link = (name: string) => sidebar().getByRole("link", { name: new RegExp(`^${name}`) });
/** The list names in the sidebar, in order. */
const names = () => [...document.querySelectorAll("[data-list-row] .nav-name")].map((n) => n.textContent);
const moves = (fetchMock: ReturnType<typeof stubApi>, l: List) => sentBodies(fetchMock, "POST", `/api/lists/${l.id}/move`);

/** Rows in order: Lists, Errands, Shed, Acme, Projects, Life, Garden; each 30 high and 200 wide, from top 100. */
const yOf = (i: number, part = 0.5) => 100 + 30 * i + 30 * part;
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("sidebar-scroll")) return { top: 0, bottom: 800, left: 0, right: 200, width: 200, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const i = [...document.querySelectorAll("[data-list-row], [data-folder-row]")].indexOf(this);
    const top = i < 0 ? 0 : 100 + 30 * i;
    const height = i < 0 ? 0 : 30;
    return { top, bottom: top + height, left: 0, right: i < 0 ? 0 : 200, width: i < 0 ? 0 : 200, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mouse = { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0 };
const touch = { ...mouse, pointerType: "touch" };

function press(el: Element, y: number, base = mouse) {
  fireEvent.pointerDown(el, { ...base, clientX: 50, clientY: y });
}
const moveTo = (y: number, x = 50, base = mouse) => fireEvent.pointerMove(document.body, { ...base, clientX: x, clientY: y });
const release = (y: number, x = 50, base = mouse) => fireEvent.pointerUp(document.body, { ...base, clientX: x, clientY: y });
/** Drags `el`, row `from`, to height `y` and lets go. */
function drag(el: Element, from: number, y: number, x = 50) {
  press(el, yOf(from));
  moveTo(yOf(from) + 8);
  moveTo(y, x);
  release(y, x);
}

async function shownWith(path = "/next") {
  const fetchMock = stubApi([], { lists });
  const view = renderAt(path);
  await waitFor(() => expect(names()).toEqual(["Errands", "Shed", "Projects", "Garden"]));
  return { fetchMock, ...view };
}

describe("dragging a list in the sidebar", () => {
  it("moves it before a list, and the sidebar shows it at once", async () => {
    const { fetchMock } = await shownWith();
    drag(link("Shed"), 2, yOf(1, 0.25));
    await waitFor(() => expect(names()).toEqual(["Shed", "Errands", "Projects", "Garden"]));
    await waitFor(() => expect(moves(fetchMock, shed)).toEqual([{ folderId: null, beforeId: errands.id }]));
  });

  it("doesn't follow the link afterwards, and leaves nothing behind", async () => {
    const { location } = await shownWith();
    drag(link("Shed"), 2, yOf(1, 0.25));
    fireEvent.click(link("Shed"));
    expect(location.history?.at(-1)).toBe("/next");
    expect(document.querySelector(".drag-ghost, .drop-line, [data-dragging], [data-drop-target]")).toBeNull();
  });

  it("moves it into another folder, beside a list there", async () => {
    const { fetchMock } = await shownWith();
    drag(link("Errands"), 1, yOf(4, 0.75));
    await waitFor(() => expect(moves(fetchMock, errands)).toEqual([{ folderId: work.id }]));
    expect(names()).toEqual(["Shed", "Projects", "Errands", "Garden"]);
  });

  it("moves it to the end of a folder dropped on, lighting the folder's name", async () => {
    const { fetchMock } = await shownWith();
    press(link("Shed"), yOf(2));
    moveTo(yOf(2) + 8);
    moveTo(yOf(5));
    expect(sidebar().getByText("Life").closest("summary")!.hasAttribute("data-drop-target")).toBe(true);
    expect(document.querySelector(".drop-line")!.hasAttribute("hidden")).toBe(true);
    release(yOf(5));
    await waitFor(() => expect(moves(fetchMock, shed)).toEqual([{ folderId: personal.id }]));
  });

  it("takes a list out of a folder on the Lists heading", async () => {
    const { fetchMock } = await shownWith();
    drag(link("Garden"), 6, yOf(0));
    await waitFor(() => expect(moves(fetchMock, garden)).toEqual([{ folderId: null, beforeId: errands.id }]));
    expect(names()).toEqual(["Garden", "Errands", "Shed", "Projects"]);
  });

  it("sends nothing for a drop where it already is, or outside the sidebar", async () => {
    const { fetchMock } = await shownWith();
    drag(link("Shed"), 2, yOf(1, 0.75));
    drag(link("Shed"), 2, yOf(2));
    drag(link("Shed"), 2, yOf(1, 0.25), 500);
    await new Promise((r) => setTimeout(r));
    expect(moves(fetchMock, shed)).toEqual([]);
  });

  it("shows the line at the gap", async () => {
    await shownWith();
    press(link("Shed"), yOf(2));
    moveTo(yOf(2) + 8);
    moveTo(yOf(1, 0.25));
    const line = document.querySelector<HTMLElement>(".drop-line")!;
    expect(line.hidden).toBe(false);
    expect(line.style.top).toBe(`${100 + 30}px`);
    release(yOf(1, 0.75));
  });

  it("cancels on Escape", async () => {
    const { fetchMock } = await shownWith();
    press(link("Shed"), yOf(2));
    moveTo(yOf(2) + 8);
    moveTo(yOf(1, 0.25));
    fireEvent.keyDown(window, { key: "Escape" });
    release(yOf(1, 0.25));
    expect(document.querySelector(".drag-ghost")).toBeNull();
    expect(moves(fetchMock, shed)).toEqual([]);
  });

  it("leaves a click alone", async () => {
    const { location } = await shownWith();
    press(link("Shed"), yOf(2));
    release(yOf(2));
    fireEvent.click(link("Shed"));
    await waitFor(() => expect(location.history?.at(-1)).toBe(`/list/${shed.id}`));
  });

  it("doesn't drag the Inbox or the views", async () => {
    await shownWith();
    press(link("Inbox"), 50);
    moveTo(70);
    expect(document.querySelector(".drag-ghost")).toBeNull();
    release(70);
  });

  it("puts it back and says so when the save fails", async () => {
    const fetchMock = stubApi([], { lists, gate: async (_m, path) => { if (path.endsWith("/move")) throw new Error("no"); } });
    renderAt("/next");
    await waitFor(() => expect(names()).toEqual(["Errands", "Shed", "Projects", "Garden"]));
    drag(link("Shed"), 2, yOf(1, 0.25));
    await screen.findByText("Boom");
    await waitFor(() => expect(names()).toEqual(["Errands", "Shed", "Projects", "Garden"]));
    expect(moves(fetchMock, shed)).toHaveLength(1);
  });
});

describe("press and hold on a touch screen", () => {
  it("lifts a list after a hold, and a drag moves it", async () => {
    const { fetchMock } = await shownWith();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const row = link("Shed").closest("[data-list-row]")!;
    press(link("Shed"), yOf(2), touch);
    vi.advanceTimersByTime(500);
    expect(row.hasAttribute("data-drag-lift")).toBe(true);
    moveTo(yOf(1, 0.25), 50, touch);
    release(yOf(1, 0.25), 50, touch);
    vi.useRealTimers();
    await waitFor(() => expect(moves(fetchMock, shed)).toEqual([{ folderId: null, beforeId: errands.id }]));
  });

  it("leaves a finger that moves first to scrolling", async () => {
    await shownWith();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    press(link("Shed"), yOf(2), touch);
    moveTo(yOf(2) + 30, 50, touch);
    vi.advanceTimersByTime(600);
    expect(document.querySelector(".drag-ghost")).toBeNull();
  });
});

describe("moving the open list from the keyboard", () => {
  it("moves it up and down with Alt+Shift and the arrows", async () => {
    const { fetchMock } = await shownWith(`/list/${shed.id}`);
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true, shiftKey: true });
    await waitFor(() => expect(moves(fetchMock, shed)).toEqual([{ folderId: null, beforeId: errands.id }]));
    await waitFor(() => expect(names()).toEqual(["Shed", "Errands", "Projects", "Garden"]));
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true, shiftKey: true });
    await waitFor(() => expect(moves(fetchMock, shed)).toHaveLength(2));
    expect(moves(fetchMock, shed)[1]).toEqual({ folderId: null, afterId: errands.id });
  });

  it("does nothing on other screens", async () => {
    const { fetchMock } = await shownWith("/next");
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
  });
});
