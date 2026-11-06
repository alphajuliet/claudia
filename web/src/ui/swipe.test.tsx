import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zonedToUtc } from "../lib/dates";
import { addDays, at, garden, main, renderAt, sentBodies, stubApi, task, today } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
const posts = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([p]) => String(p));

/** A drag on the element from (100, 100) by (dx, dy), lifting the finger at the end. jsdom rows are 0 wide, so the
 *  swipe takes them as 320 (completing at 128). */
function drag(el: Element, dx: number, dy: number, pointerType = "touch") {
  const base = { pointerType, pointerId: 1, isPrimary: true };
  fireEvent.pointerDown(el, { ...base, clientX: 100, clientY: 100 });
  for (const f of [0.25, 0.5, 0.75, 1]) fireEvent.pointerMove(el, { ...base, clientX: 100 + dx * f, clientY: 100 + dy * f });
  fireEvent.pointerUp(el, { ...base, clientX: 100 + dx, clientY: 100 + dy });
}

describe("swiping a task right on a touch screen", () => {
  it("completes it past the threshold, with Undo", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), 200, 0);
    await waitFor(() => expect(posts(fetchMock)).toEqual([`/api/tasks/${weed.id}/complete`]));
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("Completed “Weed the beds”"));
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("springs back short of the threshold and sends nothing", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    const li = row("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { pointerType: "touch", pointerId: 1, clientX: 160, clientY: 100 });
    expect(li.style.getPropertyValue("--swipe-x")).toBe("60px");
    expect(li.dataset.swipe).toBe("drag");
    fireEvent.pointerUp(title, { pointerType: "touch", pointerId: 1, clientX: 160, clientY: 100 });
    expect(li.style.getPropertyValue("--swipe-x")).toBe("0px");
    expect(li.dataset.swipe).toBe("spring");
    await waitFor(() => expect(li.dataset.swipe).toBeUndefined());
    expect(posts(fetchMock)).toEqual([]);
    expect(main().getByText("Weed the beds")).toBeTruthy();
  });

  it("leaves a mostly vertical drag to scrolling", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), 30, 80);
    drag(main().getByText("Weed the beds"), 200, 300);
    expect(row("Weed the beds").dataset.swipe).toBeUndefined();
    expect(posts(fetchMock)).toEqual([]);
  });

  it("swallows the click that follows a swipe, so the task doesn't open", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    drag(title, 60, 0);
    fireEvent.click(title);
    expect(href()).toBe(`/list/${garden.id}`);
    expect(screen.queryByRole("complementary")).toBeNull();

    // Only that one click: the next tap opens it.
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 2 });
    fireEvent.pointerUp(title, { pointerType: "touch", pointerId: 2 });
    fireEvent.click(title);
    expect(href()).toContain("?task=");
  });

  it("lets a click through once the swipe is long past (iOS sends none after a drag)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    drag(title, 60, 0);
    vi.setSystemTime(Date.now() + 600);
    fireEvent.click(title);
    expect(href()).toContain("?task=");
  });

  it("springs back without completing when the pointer is cancelled or its capture lost mid-swipe", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    const li = row("Weed the beds");
    const base = { pointerType: "touch", pointerId: 1, isPrimary: true };
    fireEvent.pointerDown(title, { ...base, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { ...base, clientX: 300, clientY: 100 });
    fireEvent.pointerCancel(title, { ...base, clientX: 300, clientY: 100 });
    expect(li.dataset.swipe).toBe("spring");
    expect(li.style.getPropertyValue("--swipe-x")).toBe("0px");

    fireEvent.pointerDown(title, { ...base, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { ...base, pointerId: 2, clientX: 300, clientY: 100 });
    fireEvent.lostPointerCapture(li, { ...base, pointerId: 2 });
    expect(li.dataset.swipe).toBe("spring");
    fireEvent.pointerUp(title, { ...base, pointerId: 2, clientX: 300, clientY: 100 });
    await waitFor(() => expect(li.dataset.swipe).toBeUndefined());
    expect(posts(fetchMock)).toEqual([]);
  });

  it("carries on when the title loses its implicit capture to the row", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    const li = row("Weed the beds");
    const base = { pointerType: "touch", pointerId: 1, isPrimary: true };
    fireEvent.pointerDown(title, { ...base, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { ...base, clientX: 150, clientY: 100 });
    fireEvent.lostPointerCapture(title, base);
    expect(li.dataset.swipe).toBe("drag");
    fireEvent.pointerMove(li, { ...base, clientX: 300, clientY: 100 });
    expect(li.style.getPropertyValue("--swipe-x")).toBe("200px");
    fireEvent.pointerUp(li, { ...base, clientX: 300, clientY: 100 });
    await waitFor(() => expect(posts(fetchMock)).toEqual([`/api/tasks/${weed.id}/complete`]));
  });

  it("does nothing when a press is cancelled before it moves", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(title, { pointerType: "touch", pointerId: 1, isPrimary: true });
    expect(row("Weed the beds").dataset.swipe).toBeUndefined();
    expect(posts(fetchMock)).toEqual([]);
  });

  it("starts afresh after a lost pointerup", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 140, clientY: 100 });
    // No pointerup: the next press is a new swipe.
    const base = { pointerType: "touch", pointerId: 5, isPrimary: true };
    fireEvent.pointerDown(title, { ...base, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(title, { ...base, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(title, { ...base, clientX: 300, clientY: 100 });
    await waitFor(() => expect(posts(fetchMock)).toEqual([expect.stringContaining("/complete")]));
  });

  it("reopens a completed task", async () => {
    const plan = task({ title: "Plan", listId: garden.id, completedAt: at });
    const fetchMock = stubApi([plan]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Show completed" }));
    const title = await main().findByText("Plan");
    expect(row("Plan").querySelector(".swipe-complete")!.textContent).toBe("Reopen");
    drag(title, 200, 0);
    await waitFor(() => expect(posts(fetchMock)).toEqual([`/api/tasks/${plan.id}/uncomplete`]));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Reopened “Plan”"));
  });

  it("ignores a mouse drag, and a touch drag that starts on the checkbox", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), 200, 0, "mouse");
    drag(main().getByRole("checkbox", { name: "Complete Weed the beds" }), 200, 0);
    expect(row("Weed the beds").dataset.swipe).toBeUndefined();
    expect(posts(fetchMock)).toEqual([]);
  });
});

afterEach(() => vi.useRealTimers());

const tz = "Australia/Sydney";
const sheet = (name: string) => screen.queryByRole("dialog", { name });

describe("swiping a task left on a touch screen", () => {
  it("reveals Date and Snooze past half their width, and not short of it", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id }), task({ title: "Mow", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Mow"), -30, 0);
    expect(main().queryByRole("button", { name: "Date for Mow" })).toBeNull();
    expect(row("Mow").dataset.swipe).not.toBe("open");

    drag(main().getByText("Weed the beds"), -100, 0);
    const li = row("Weed the beds");
    expect(li.dataset.swipe).toBe("open");
    expect(li.style.getPropertyValue("--swipe-x")).toBe("-144px");
    expect(main().getByRole("button", { name: "Date for Weed the beds" })).toBeTruthy();
    expect(main().getByRole("button", { name: "Snooze Weed the beds" })).toBeTruthy();
  });

  it("Date opens the Due sheet, and a quick choice saves and closes it", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    const { href } = renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Date for Weed the beds" }));
    const dialog = await screen.findByRole("dialog", { name: "Due" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(href()).toBe(`/list/${garden.id}`);
    expect(row("Weed the beds").dataset.swipe).not.toBe("open");
    await userEvent.click(within(dialog).getByRole("button", { name: "Due: Tomorrow" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: addDays(today, 1), dueAt: null }]));
    expect(sheet("Due")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row("Weed the beds")));
  });

  it("Snooze opens the Snooze sheet, and a quick choice snoozes, closes it and hides the row, with Undo", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Snooze Weed the beds" }));
    const dialog = await screen.findByRole("dialog", { name: "Snooze" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Snooze: Tomorrow" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ snoozedUntil: zonedToUtc(addDays(today, 1), "00:00", tz) }]));
    expect(sheet("Snooze")).toBeNull();
    await waitFor(() => expect(main().queryByText("Weed the beds")).toBeNull());
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("Snoozed “Weed the beds” until Tomorrow"));
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ snoozedUntil: null }));
    expect(await main().findByText("Weed the beds")).toBeTruthy();
  });

  it("keeps one row open at a time, and closes it on a tap elsewhere, a scroll or a swipe right", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id }), task({ title: "Mow", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    drag(main().getByText("Mow"), -100, 0);
    expect(row("Mow").dataset.swipe).toBe("open");
    expect(row("Weed the beds").dataset.swipe).not.toBe("open");
    expect(main().queryByRole("button", { name: "Date for Weed the beds" })).toBeNull();

    fireEvent.pointerDown(document.body, { pointerType: "touch", pointerId: 3 });
    expect(row("Mow").dataset.swipe).not.toBe("open");

    drag(main().getByText("Mow"), -100, 0);
    fireEvent.scroll(screen.getByRole("main"));
    expect(row("Mow").dataset.swipe).not.toBe("open");

    drag(main().getByText("Mow"), -100, 0);
    drag(main().getByText("Mow"), 200, 0);
    expect(row("Mow").dataset.swipe).not.toBe("open");
    expect(posts(fetchMock)).toEqual([]);
  });

  it("closes an open row on a tap on it, without opening the task", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    drag(title, -100, 0);
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 2, isPrimary: true });
    fireEvent.pointerUp(title, { pointerType: "touch", pointerId: 2, isPrimary: true });
    fireEvent.click(title);
    expect(row("Weed the beds").dataset.swipe).not.toBe("open");
    expect(href()).toBe(`/list/${garden.id}`);
  });

  it("clamps a left drag at the buttons' width", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(title, { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 50, clientY: 100 });
    expect(row("Weed the beds").style.getPropertyValue("--swipe-x")).toBe("-144px");
  });

  it("doesn't spring open again after its checkbox is tapped twice", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Show completed" }));
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("checkbox", { name: "Complete Weed the beds" }));
    await userEvent.click(await main().findByRole("checkbox", { name: "Reopen Weed the beds" }));
    await main().findByRole("checkbox", { name: "Complete Weed the beds" });
    expect(row("Weed the beds").dataset.swipe).not.toBe("open");
  });

  it("closes the sheet on a tap on the backdrop", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Date for Weed the beds" }));
    await screen.findByRole("dialog", { name: "Due" });
    await userEvent.click(document.querySelector(".sheet-backdrop")!);
    expect(sheet("Due")).toBeNull();
  });

  it("keeps Tab inside the sheet", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Date for Weed the beds" }));
    const dialog = await screen.findByRole("dialog", { name: "Due" });
    await userEvent.tab({ shift: true });
    const focusables = dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    await userEvent.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Done" }));
  });

  it("says so when the task has gone", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) =>
      path === `/api/tasks/${weed.id}` && !init?.method
        ? new Response(JSON.stringify({ error: { code: "not_found", message: "Task not found" } }), { status: 404 })
        : original(path, init));
    await userEvent.click(main().getByRole("button", { name: "Date for Weed the beds" }));
    const dialog = await screen.findByRole("dialog", { name: "Due" });
    await waitFor(() => expect(dialog.textContent).toContain("This task no longer exists."));
  });

  it("Escape and Done close the sheet, and keys stay in it", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id }), task({ title: "Mow", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    drag(await main().findByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Date for Weed the beds" }));
    const dialog = await screen.findByRole("dialog", { name: "Due" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("j");
    // j would move the highlight on to Mow.
    expect(row("Mow").classList.contains("highlighted")).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(sheet("Due")).toBeNull();

    drag(main().getByText("Weed the beds"), -100, 0);
    await userEvent.click(main().getByRole("button", { name: "Snooze Weed the beds" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Snooze" })).getByRole("button", { name: "Done" }));
    expect(sheet("Snooze")).toBeNull();
  });

  it("doesn't reveal on a completed task", async () => {
    stubApi([task({ title: "Plan", listId: garden.id, completedAt: at })]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Show completed" }));
    drag(await main().findByText("Plan"), -100, 0);
    expect(row("Plan").dataset.swipe).not.toBe("open");
    expect(row("Plan").querySelector(".swipe-actions")).toBeNull();
  });
});
