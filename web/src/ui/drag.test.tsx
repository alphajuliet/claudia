import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@claudia/shared";
import { errands, garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
/** The task titles on screen, in order. */
const titles = () => main().getAllByRole("listitem").map((li) => li.querySelector(".task-title")?.textContent);
const headings = () => main().getAllByRole("region").map((r) => r.querySelector(".section-title-button")?.textContent);
const section = (name: string) => within(main().getByRole("region", { name }));
const moves = (fetchMock: ReturnType<typeof stubApi>, t: Task) => sentBodies(fetchMock, "POST", `/api/tasks/${t.id}/move`);
const sidebarLink = (name: string) => within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: new RegExp(`^${name}`) });

/** jsdom lays nothing out: item i on screen (rows and headings, in order) sits at top 100 + 30i, 30 high, 600 wide. */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const i = [...document.querySelectorAll("main [data-task-id]")].indexOf(this);
    const top = i < 0 ? 0 : 100 + 30 * i;
    const height = i < 0 ? 0 : 30;
    const width = i < 0 ? 0 : 600;
    return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (document as Partial<Document>).elementFromPoint;
});

/** The y of a point `part` of the way down item i. */
const yOf = (i: number, part = 0.5) => 100 + 30 * i + 30 * part;
const mouse = { pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0 };

/** Presses on `el` (item `from`) at x 50 and moves past the threshold, so the drag starts. */
function start(el: Element, from: number, base = mouse) {
  fireEvent.pointerDown(el, { ...base, clientX: 50, clientY: yOf(from) });
  fireEvent.pointerMove(document.body, { ...base, clientX: 50, clientY: yOf(from) + 8 });
}
const moveTo = (x: number, y: number, base = mouse) => fireEvent.pointerMove(document.body, { ...base, clientX: x, clientY: y });
const release = (x: number, y: number, base = mouse) => fireEvent.pointerUp(document.body, { ...base, clientX: x, clientY: y });

/** A whole mouse drag of `el` (item `from`) to (x, y), released there. */
function drag(el: Element, from: number, x: number, y: number) {
  start(el, from);
  moveTo(x, y);
  release(x, y);
}

/** Nothing of a drag is left on the page. */
function expectCleared() {
  expect(document.querySelector(".drag-ghost, .drop-line, [data-dragging], [data-drop-into], [data-drop-target]")).toBeNull();
  expect(document.body.dataset.drag).toBeUndefined();
}

function threeTasks() {
  const tasks = [
    task({ title: "Weed the beds", listId: garden.id }),
    task({ title: "Plant tomatoes", listId: garden.id }),
    task({ title: "Mulch the roses", listId: garden.id }),
  ];
  const fetchMock = stubApi(tasks);
  const view = renderAt(`/list/${garden.id}`);
  return { tasks, fetchMock, ...view };
}

describe("dragging in a list", () => {
  it("moves a task to the gap it is dropped in, and swallows the click after", async () => {
    const { tasks: [a, , c], fetchMock } = threeTasks();
    const title = await main().findByText("Mulch the roses");
    start(title, 2);
    expect(row("Mulch the roses").dataset.dragging).toBeDefined();
    expect(document.querySelector(".drag-ghost")?.textContent).toBe("Mulch the roses");
    expect(document.body.dataset.drag).toBeDefined();
    moveTo(50, yOf(0, 0.1));
    expect(document.querySelector(".drop-line")).toBeTruthy();
    release(50, yOf(0, 0.1));
    // The browser's click after the drag doesn't rename.
    fireEvent.click(title);
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
    expectCleared();
    await waitFor(() => expect(moves(fetchMock, c!)).toEqual([{ parentId: null, beforeId: a!.id }]));
    await waitFor(() => expect(titles()).toEqual(["Mulch the roses", "Weed the beds", "Plant tomatoes"]));
  });

  it("leaves a press without movement to rename and select", async () => {
    const { fetchMock, href } = threeTasks();
    const title = await main().findByText("Plant tomatoes");
    fireEvent.pointerDown(title, { ...mouse, clientX: 50, clientY: yOf(1) });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 52, clientY: yOf(1) + 2 });
    fireEvent.pointerUp(document.body, { ...mouse, clientX: 52, clientY: yOf(1) + 2 });
    fireEvent.click(title);
    const input = main().getByRole("textbox", { name: "Title" });
    fireEvent.keyDown(input, { key: "Escape" });

    const li = row("Weed the beds");
    fireEvent.pointerDown(li, { ...mouse, clientX: 500, clientY: yOf(0) });
    fireEvent.pointerUp(li, { ...mouse, clientX: 500, clientY: yOf(0) });
    fireEvent.click(li);
    expect(href()).toContain("?task=");
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expectCleared();
  });

  it("makes a task the last subtask of the row it is dropped on", async () => {
    const { tasks: [, b, c], fetchMock } = threeTasks();
    drag(await main().findByText("Mulch the roses"), 2, 50, yOf(1, 0.5));
    await waitFor(() => expect(moves(fetchMock, c!)).toEqual([{ parentId: b!.id }]));
    await waitFor(() => expect(row("Mulch the roses").dataset.depth).toBe("1"));
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
  });

  it("picks the depth in a gap after a subtask from how far the pointer moves sideways", async () => {
    const p = task({ title: "Plant tomatoes", listId: garden.id });
    const tasks = [p, task({ title: "Stake them", listId: garden.id, parentId: p.id }), task({ title: "Weed the beds", listId: garden.id }), task({ title: "Water", listId: garden.id })];
    const [, , x, y] = tasks;
    const fetchMock = stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    // Straight up: the top level, after the parent and its subtask.
    drag(await main().findByText("Water"), 3, 50, yOf(1, 0.9));
    await waitFor(() => expect(moves(fetchMock, y!)).toEqual([{ parentId: null, beforeId: x!.id }]));
    await waitFor(() => expect(titles()).toEqual(["Plant tomatoes", "Stake them", "Water", "Weed the beds"]));
    expect(row("Water").dataset.depth).toBe("0");

    // One indent to the right: a sibling of the subtask.
    drag(main().getByText("Water"), 2, 70, yOf(1, 0.9));
    await waitFor(() => expect(moves(fetchMock, y!).at(-1)).toEqual({ parentId: p.id }));
    await waitFor(() => expect(row("Water").dataset.depth).toBe("1"));
    expect(titles()).toEqual(["Plant tomatoes", "Stake them", "Water", "Weed the beds"]);
  });

  it("puts a task dropped on the middle of a heading first in its section", async () => {
    const tasks = [
      task({ title: "Weed the beds", listId: garden.id }),
      task({ title: "Spring", kind: "heading", listId: garden.id }),
      task({ title: "Plant tomatoes", listId: garden.id }),
    ];
    const [a, h] = tasks;
    const fetchMock = stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), 0, 50, yOf(1, 0.5));
    await waitFor(() => expect(moves(fetchMock, a!)).toEqual([{ parentId: null, afterId: h!.id }]));
    await waitFor(() => expect(section("Spring").getAllByRole("listitem").map((li) => li.querySelector(".task-title")?.textContent)).toEqual(["Weed the beds", "Plant tomatoes"]));
  });

  it("moves a heading with its section, only between sections", async () => {
    const tasks = [
      task({ title: "Weed the beds", listId: garden.id }),
      task({ title: "Spring", kind: "heading", listId: garden.id }),
      task({ title: "Plant tomatoes", listId: garden.id }),
      task({ title: "Summer", kind: "heading", listId: garden.id }),
      task({ title: "Mulch the roses", listId: garden.id }),
    ];
    const [, spring] = tasks;
    const fetchMock = stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Plant tomatoes");
    const button = main().getByRole("button", { name: "Spring" });
    start(button, 1);
    expect(button.closest("section")!.dataset.dragging).toBeDefined();
    // Over the top section's task, the line snaps to a gap between sections.
    moveTo(50, yOf(0, 0.5));
    expect(document.querySelector(".drop-line")).toBeTruthy();
    moveTo(50, yOf(4, 0.9));
    release(50, yOf(4, 0.9));
    expectCleared();
    await waitFor(() => expect(moves(fetchMock, spring!)).toEqual([{ parentId: null, withSection: true }]));
    await waitFor(() => expect(headings()).toEqual(["Summer", "Spring"]));
    expect(section("Spring").getByText("Plant tomatoes")).toBeTruthy();
    expect(titles()).toEqual(["Weed the beds", "Mulch the roses", "Plant tomatoes"]);
  });

  it("cancels with Escape, leaving the panel open", async () => {
    const { fetchMock, href } = threeTasks();
    await main().findByText("Weed the beds");
    fireEvent.click(row("Weed the beds"));
    expect(href()).toContain("?task=");
    await screen.findByRole("complementary");
    start(main().getByText("Mulch the roses"), 2);
    moveTo(50, yOf(0, 0.1));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expectCleared();
    release(50, yOf(0, 0.1));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
    expect(screen.getByRole("complementary")).toBeTruthy();
    // Escape with no drag still closes it.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });

  it("swallows the click after the mouse-up that follows an Escape", async () => {
    const { href } = threeTasks();
    const title = await main().findByText("Mulch the roses");
    start(title, 2);
    fireEvent.keyDown(document.body, { key: "Escape" });
    moveTo(50, yOf(2));
    release(50, yOf(2));
    fireEvent.click(title);
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(href()).not.toContain("?task=");
    await new Promise((r) => setTimeout(r, 5));
    // Only that one: the next click renames.
    fireEvent.click(title);
    expect(main().getByRole("textbox", { name: "Title" })).toBeTruthy();
  });

  it("draws the line at the next row's top edge, not across the dragged rows", async () => {
    const a = task({ title: "Weed the beds", listId: garden.id });
    const b = task({ title: "Plant tomatoes", listId: garden.id });
    stubApi([a, b, task({ title: "Stake them", listId: garden.id, parentId: b.id }), task({ title: "Mulch the roses", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Stake them");
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Stake them", "Mulch the roses"]);
    // .task-sections is at 0 in jsdom, so the line's top is the gap's y.
    start(main().getByText("Plant tomatoes"), 1);
    moveTo(50, yOf(3, 0.1));
    expect(document.querySelector<HTMLElement>(".drop-line")!.style.top).toBe(`${yOf(3, 0)}px`);
    moveTo(50, yOf(3, 0.9));
    expect(document.querySelector<HTMLElement>(".drop-line")!.style.top).toBe(`${yOf(4, 0)}px`);
    fireEvent.keyDown(document.body, { key: "Escape" });
    release(50, yOf(3, 0.9));
  });

  it("leaves a touch that moves at once to the swipes and scrolling", async () => {
    const { fetchMock } = threeTasks();
    const touch = { ...mouse, pointerType: "touch" };
    start(await main().findByText("Mulch the roses"), 2, touch);
    moveTo(50, yOf(0, 0.1), touch);
    expect(document.querySelector(".drag-ghost, [data-dragging]")).toBeNull();
    release(50, yOf(0, 0.1), touch);
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
  });

  it("doesn't drag on a view", async () => {
    const tasks = [
      task({ title: "Weed the beds", listId: garden.id, labels: ["next"] }),
      task({ title: "Plant tomatoes", listId: garden.id, labels: ["next"] }),
    ];
    const fetchMock = stubApi(tasks);
    renderAt("/next");
    start(await main().findByText("Plant tomatoes"), 1);
    moveTo(50, yOf(0, 0.1));
    expect(document.querySelector(".drag-ghost, [data-dragging]")).toBeNull();
    release(50, yOf(0, 0.1));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes"]);
  });
});

describe("dropping on a sidebar list", () => {
  /** The sidebar link under the pointer at x < 0, as `document.elementFromPoint` would find it. */
  function overLink(name: string) {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: (x: number) => (x < 0 ? sidebarLink(name).querySelector(".nav-name") : null),
    });
  }

  it("moves the task to the end of that list, with Undo", async () => {
    const { tasks: [, b, c], fetchMock } = threeTasks();
    await main().findByText("Plant tomatoes");
    overLink("Errands");
    start(main().getByText("Plant tomatoes"), 1);
    moveTo(-100, 150);
    expect(sidebarLink("Errands").dataset.dropTarget).toBeDefined();
    expect(document.querySelector<HTMLElement>(".drop-line")?.hidden).toBe(true);
    release(-100, 150);
    expectCleared();
    await waitFor(() => expect(moves(fetchMock, b!)).toEqual([{ listId: errands.id, parentId: null }]));
    await waitFor(() => expect(titles()).toEqual(["Weed the beds", "Mulch the roses"]));
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("Moved to Errands"));
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(moves(fetchMock, b!).at(-1)).toEqual({ listId: garden.id, parentId: null, beforeId: c!.id }));
    await waitFor(() => expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]));
  });

  it("doesn't take a drop on the list's own link", async () => {
    const { fetchMock } = threeTasks();
    await main().findByText("Plant tomatoes");
    overLink("Garden");
    start(main().getByText("Plant tomatoes"), 1);
    moveTo(-100, yOf(1));
    expect(sidebarLink("Garden").dataset.dropTarget).toBeUndefined();
    release(-100, yOf(1));
    expectCleared();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
  });
});

describe("press and hold to drag on a touch screen", () => {
  const touch = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 };
  /** Presses `el` (item `from`) with a finger at x 50 and, with the clock faked, holds it for `ms`. */
  function hold(el: Element, from: number, ms = 500) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    fireEvent.pointerDown(el, { ...touch, clientX: 50, clientY: yOf(from) });
    vi.advanceTimersByTime(ms);
  }
  afterEach(() => vi.useRealTimers());

  it("lifts the row after 500ms, then moves it to where the finger lets go", async () => {
    const { tasks: [a, , c], fetchMock, href } = threeTasks();
    const title = await main().findByText("Mulch the roses");
    hold(title, 2, 499);
    expect(document.body.dataset.drag).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(row("Mulch the roses").dataset.dragLift).toBeDefined();
    expect(document.body.dataset.drag).toBeDefined();
    // The page doesn't scroll under the finger.
    const scroll = new Event("touchmove", { bubbles: true, cancelable: true });
    title.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(true);
    // A finger's moves go to the element it pressed. Sideways, the swipe has stood down: the row doesn't follow.
    fireEvent.pointerMove(title, { ...touch, clientX: 150, clientY: yOf(2) });
    expect(row("Mulch the roses").dataset.swipe).toBeUndefined();
    fireEvent.pointerMove(title, { ...touch, clientX: 50, clientY: yOf(0, 0.1) });
    expect(document.querySelector(".drop-line")).toBeTruthy();
    release(50, yOf(0, 0.1), touch);
    fireEvent.click(title);
    expect(href()).not.toContain("?task=");
    expectCleared();
    expect(document.querySelector("[data-drag-lift]")).toBeNull();
    vi.useRealTimers();
    await waitFor(() => expect(moves(fetchMock, c!)).toEqual([{ parentId: null, beforeId: a!.id }]));
    await waitFor(() => expect(titles()).toEqual(["Mulch the roses", "Weed the beds", "Plant tomatoes"]));
  });

  it("lifts a heading with its section", async () => {
    const tasks = [
      task({ title: "Spring", kind: "heading", listId: garden.id }),
      task({ title: "Plant tomatoes", listId: garden.id }),
      task({ title: "Summer", kind: "heading", listId: garden.id }),
      task({ title: "Mulch the roses", listId: garden.id }),
    ];
    const fetchMock = stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Plant tomatoes");
    hold(main().getByRole("button", { name: "Spring" }), 0);
    moveTo(50, yOf(3, 0.9), touch);
    release(50, yOf(3, 0.9), touch);
    vi.useRealTimers();
    await waitFor(() => expect(moves(fetchMock, tasks[0]!)).toEqual([{ parentId: null, withSection: true }]));
    await waitFor(() => expect(headings()).toEqual(["Summer", "Spring"]));
  });

  it("doesn't drag when the finger moves first, and a sideways move still swipes", async () => {
    const { fetchMock } = threeTasks();
    const title = await main().findByText("Mulch the roses");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Down the screen: a scroll.
    fireEvent.pointerDown(title, { ...touch, clientX: 50, clientY: yOf(2) });
    fireEvent.pointerMove(title, { ...touch, clientX: 50, clientY: yOf(2) - 20 });
    vi.advanceTimersByTime(600);
    expect(document.body.dataset.drag).toBeUndefined();
    const scroll = new Event("touchmove", { bubbles: true, cancelable: true });
    title.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    fireEvent.pointerCancel(title, { ...touch });

    // Sideways: a swipe, which completes it.
    const li = row("Mulch the roses");
    fireEvent.pointerDown(title, { ...touch, clientX: 50, clientY: yOf(2) });
    fireEvent.pointerMove(title, { ...touch, clientX: 120, clientY: yOf(2) });
    vi.advanceTimersByTime(600);
    expect(document.body.dataset.drag).toBeUndefined();
    expect(li.dataset.dragLift).toBeUndefined();
    fireEvent.pointerMove(title, { ...touch, clientX: 250, clientY: yOf(2) });
    expect(li.dataset.swipe).toBe("drag");
    fireEvent.pointerUp(title, { ...touch, clientX: 250, clientY: yOf(2) });
    vi.useRealTimers();
    await waitFor(() => expect(fetchMock.mock.calls.some(([p]) => String(p).endsWith("/complete"))).toBe(true));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
  });

  it("leaves a quick tap to open the task", async () => {
    const { href } = threeTasks();
    const title = await main().findByText("Plant tomatoes");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    fireEvent.pointerDown(title, { ...touch, clientX: 50, clientY: yOf(1) });
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(title, { ...touch, clientX: 50, clientY: yOf(1) });
    vi.advanceTimersByTime(600);
    expect(document.body.dataset.drag).toBeUndefined();
    fireEvent.click(title);
    expect(href()).toContain("?task=");
  });

  it("does nothing when let go without moving after the lift, and ignores the click", async () => {
    const { fetchMock, href } = threeTasks();
    const title = await main().findByText("Plant tomatoes");
    hold(title, 1);
    expect(row("Plant tomatoes").dataset.dragLift).toBeDefined();
    fireEvent.pointerUp(title, { ...touch, clientX: 50, clientY: yOf(1) });
    fireEvent.click(title);
    expect(href()).not.toContain("?task=");
    expectCleared();
    expect(document.querySelector("[data-drag-lift]")).toBeNull();
    vi.advanceTimersByTime(600);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
    // Only that click: the next tap opens it.
    fireEvent.pointerDown(title, { ...touch, pointerId: 8, clientX: 50, clientY: yOf(1) });
    fireEvent.pointerUp(title, { ...touch, pointerId: 8, clientX: 50, clientY: yOf(1) });
    fireEvent.click(title);
    expect(href()).toContain("?task=");
  });

  it("closes Date and Snooze on a row lifted while they show", async () => {
    threeTasks();
    const title = await main().findByText("Plant tomatoes");
    const base = { ...touch, pointerId: 9 };
    fireEvent.pointerDown(title, { ...base, clientX: 200, clientY: yOf(1) });
    fireEvent.pointerMove(title, { ...base, clientX: 100, clientY: yOf(1) });
    fireEvent.pointerUp(title, { ...base, clientX: 100, clientY: yOf(1) });
    expect(row("Plant tomatoes").dataset.swipe).toBe("open");
    hold(title, 1);
    fireEvent.pointerMove(title, { ...touch, clientX: 50, clientY: yOf(0, 0.1) });
    expect(row("Plant tomatoes").dataset.swipe).not.toBe("open");
    fireEvent.keyDown(document.body, { key: "Escape" });
    release(50, yOf(0, 0.1), touch);
  });

  it("cancels when the system cancels the touch", async () => {
    const { fetchMock } = threeTasks();
    const title = await main().findByText("Mulch the roses");
    hold(title, 2);
    moveTo(50, yOf(0, 0.1), touch);
    fireEvent.pointerCancel(document.body, { ...touch });
    expectCleared();
    release(50, yOf(0, 0.1), touch);

    hold(title, 2);
    moveTo(50, yOf(0, 0.1), touch);
    fireEvent.touchCancel(title);
    expectCleared();
    expect(document.querySelector("[data-drag-lift]")).toBeNull();
    release(50, yOf(0, 0.1), touch);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
  });
});
