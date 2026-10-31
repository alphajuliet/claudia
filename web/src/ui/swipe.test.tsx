import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { at, garden, main, renderAt, stubApi, task } from "./testApi";

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

  it("doesn't swipe a left drag on a task", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(title, { pointerType: "touch", pointerId: 1, clientX: 50, clientY: 100 });
    expect(row("Weed the beds").style.getPropertyValue("--swipe-x")).toBe("0px");
    fireEvent.pointerUp(title, { pointerType: "touch", pointerId: 1, clientX: 50, clientY: 100 });
    expect(posts(fetchMock)).toEqual([]);
  });
});
