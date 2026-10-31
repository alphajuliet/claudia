import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@claudia/shared";
import { errands, garden, inbox, main, projects, renderAt, sentBodies, stubApi, task } from "./testApi";

/** A promise to settle later, for holding a request. */
function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = () => rej(new Error("held")); });
  return { promise, resolve, reject };
}

/** Holds each request the gate sees, in order; `held[i]` settles the i-th. */
function holdAll() {
  const held: ReturnType<typeof deferred>[] = [];
  const gate = () => { const d = deferred(); held.push(d); return d.promise; };
  return { held, gate };
}

const panel = () => screen.findByRole("complementary", { name: "Task details" });
const inPanel = async () => within(await panel());

/** Opens a list screen with `t` selected, and waits for the panel to show it. */
async function openOn(t: Task, tasks: Task[] = [t], opts: Parameters<typeof stubApi>[1] = {}) {
  const fetchMock = stubApi(tasks, opts);
  const view = renderAt(`/list/${t.listId}?task=${t.id}`);
  const p = await inPanel();
  await p.findByDisplayValue(t.title);
  return { fetchMock, view, p };
}

describe("selecting a task", () => {
  it("puts ?task= in the address, marks the row and opens the panel", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    stubApi([weed, task({ title: "Plant tomatoes", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    const row = (await main().findByText("Weed the beds")).closest("li")!;
    expect(row.getAttribute("aria-current")).toBeNull();
    await userEvent.click(row);
    expect(href()).toBe(`/list/${garden.id}?task=${weed.id}`);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect((await inPanel()).getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Weed the beds");
  });

  it("doesn't select when the checkbox or title is clicked", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByText("Weed the beds"));
    expect(href()).toBe(`/list/${garden.id}`);
  });

  it("closes with the close button or Escape in the panel, keeping the path", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { view, p } = await openOn(weed);
    await userEvent.click(p.getByRole("button", { name: "Close" }));
    expect(view.href()).toBe(`/list/${garden.id}`);
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

    await userEvent.click((await main().findByText("Weed the beds")).closest("li")!);
    const again = await inPanel();
    await userEvent.click(again.getByRole("textbox", { name: "Notes" }));
    await userEvent.keyboard("{Escape}");
    expect(view.href()).toBe(`/list/${garden.id}`);
  });

  it("fetches a task that isn't on screen", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const fetchMock = stubApi([weed]);
    renderAt(`/inbox?task=${weed.id}`);
    expect(await (await inPanel()).findByDisplayValue("Weed the beds")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([p]) => p === `/api/tasks/${weed.id}`)).toBe(true);
  });

  it("says so when the task no longer exists", async () => {
    stubApi([]);
    const { href } = renderAt("/inbox?task=01JB0000000000000000099999");
    const p = await inPanel();
    expect(await p.findByText("This task no longer exists.")).toBeTruthy();
    await userEvent.click(p.getByRole("button", { name: "Close" }));
    expect(href()).toBe("/inbox");
  });
});

describe("the detail panel", () => {
  it("saves a new title on Enter", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    const title = p.getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Weed the veggie beds{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ title: "Weed the veggie beds" }]);
    expect(await main().findByText("Weed the veggie beds")).toBeTruthy();
  });

  it("saves notes on blur and says so", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await userEvent.type(p.getByRole("textbox", { name: "Notes" }), "Start with the roses");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([]);
    await userEvent.tab();
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ notes: "Start with the roses" }]);
    expect(await p.findByText("Saved")).toBeTruthy();
  });

  it("shows a failed save beside the field", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { p } = await openOn(weed, [weed], { failUpdate: true });
    await userEvent.type(p.getByRole("textbox", { name: "Notes" }), "Roses first");
    await userEvent.tab();
    expect(await p.findByText("Boom")).toBeTruthy();
  });

  it("sets and clears the due date", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    fireEvent.change(p.getByLabelText("Due"), { target: { value: "2026-11-05" } });
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-05" }]));
    await userEvent.click(await p.findByRole("button", { name: "Clear due date" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ dueDate: null });
  });

  it("sets the start date", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, startDate: "2026-11-01" });
    const { fetchMock, p } = await openOn(weed);
    await userEvent.click(p.getByRole("button", { name: "Clear start date" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ startDate: null }]);
  });

  it("shows a due time read-only, with Clear", async () => {
    const call = task({ title: "Call Sam", listId: garden.id, dueAt: "2026-11-03T08:00:00.000Z" });
    const { fetchMock, p } = await openOn(call);
    // The row's label already says Due.
    expect(p.getByRole("group", { name: "Due" }).textContent).toContain("3 Nov, 7:00 pm");
    await userEvent.click(p.getByRole("button", { name: "Clear due date" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${call.id}`)).toEqual([{ dueAt: null }]);
  });

  it("adds and removes labels, sending the whole set", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, labels: ["next"] });
    const { fetchMock, p } = await openOn(weed);
    await userEvent.type(p.getByRole("combobox", { name: "Add a label" }), "outside{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["next", "outside"] }]);
    await userEvent.click(await p.findByRole("button", { name: "Remove label next" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ labels: ["outside"] });
  });

  it("moves the task to another list, grouped by folder", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    const select = p.getByRole("combobox", { name: "List" }) as HTMLSelectElement;
    expect(select.value).toBe(garden.id);
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Acme", "Life"]);
    expect([...select.options].map((o) => o.text)).toEqual(["Inbox", "Errands", "Projects", "Garden"]);
    await userEvent.selectOptions(select, errands.id);
    expect(sentBodies(fetchMock, "POST", `/api/tasks/${weed.id}/move`)).toEqual([{ listId: errands.id }]);
    // It has left the list on screen.
    await waitFor(() => expect(main().queryByText("Weed the beds")).toBeNull());
    expect(await p.findByText("Saved")).toBeTruthy();
  });

  it("turns repeat on with a preset, from the due date", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    expect(p.queryByRole("radio")).toBeNull();
    await userEvent.selectOptions(p.getByRole("combobox", { name: "Repeat" }), "Every week");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ recurRule: "FREQ=WEEKLY", recurFrom: "due" }]);
    await userEvent.click(await p.findByRole("radio", { name: "From completion" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ recurRule: "FREQ=WEEKLY", recurFrom: "completion" });
  });

  it("turns repeat off", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, recurRule: "FREQ=DAILY", recurFrom: "completion" });
    const { fetchMock, p } = await openOn(weed);
    expect((p.getByRole("radio", { name: "From completion" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.selectOptions(p.getByRole("combobox", { name: "Repeat" }), "Doesn't repeat");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ recurRule: null, recurFrom: null }]);
  });

  it("takes a custom rule and shows the server's objection", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, recurRule: "FREQ=WEEKLY;BYDAY=SA", recurFrom: "due" });
    const { fetchMock, p } = await openOn(weed);
    expect((p.getByRole("combobox", { name: "Repeat" }) as HTMLSelectElement).value).toBe("custom");
    const rule = p.getByRole("textbox", { name: "Repeat rule" }) as HTMLInputElement;
    expect(rule.value).toBe("FREQ=WEEKLY;BYDAY=SA");
    await userEvent.clear(rule);
    await userEvent.type(rule, "every saturday{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ recurRule: "every saturday", recurFrom: "due" }]);
    expect(await p.findByText("recurRule must be a daily or longer RRULE such as FREQ=WEEKLY;BYDAY=MO")).toBeTruthy();
  });

  it("shows open subtasks, completes them and adds new ones", async () => {
    const parent = task({ title: "Plan the garden", listId: garden.id });
    const seeds = task({ title: "Order seeds", listId: garden.id, parentId: parent.id });
    const done = task({ title: "Measure the beds", listId: garden.id, parentId: parent.id, completedAt: "2026-10-30T00:00:00.000Z" });
    const { fetchMock, p } = await openOn(parent, [parent, seeds, done]);
    const subtasks = within(await p.findByRole("list", { name: "Subtasks" }));
    expect(await subtasks.findByText("Order seeds")).toBeTruthy();
    expect(subtasks.queryByText("Measure the beds")).toBeNull();

    await userEvent.type(p.getByRole("textbox", { name: "Add a subtask" }), "Buy compost{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ listId: garden.id, parentId: parent.id, title: "Buy compost" }]);
    expect(await subtasks.findByText("Buy compost")).toBeTruthy();

    await userEvent.click(subtasks.getByRole("checkbox", { name: "Complete Order seeds" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Completed “Order seeds”"));
    await waitFor(() => expect(subtasks.queryByText("Order seeds")).toBeNull());
  });

  it("deletes after asking, closes and says so", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const { fetchMock, view, p } = await openOn(weed);
    await userEvent.click(p.getByRole("button", { name: "Delete task" }));
    expect(confirm).toHaveBeenCalledWith("Delete “Weed the beds” and its subtasks? This can't be undone.");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    confirm.mockReturnValue(true);
    await userEvent.click(p.getByRole("button", { name: "Delete task" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([path, init]) => path === `/api/tasks/${weed.id}` && init?.method === "DELETE")).toHaveLength(1));
    expect(view.href()).toBe(`/list/${garden.id}`);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Deleted “Weed the beds”"));
    expect(main().queryByText("Weed the beds")).toBeNull();
  });

  it("shows only the title and delete for a heading", async () => {
    const heading = task({ title: "Spring", listId: projects.id, kind: "heading" });
    stubApi([heading]);
    renderAt(`/inbox?task=${heading.id}`);
    const p = await inPanel();
    expect(await p.findByDisplayValue("Spring")).toBeTruthy();
    expect(p.getByRole("button", { name: "Delete heading" })).toBeTruthy();
    expect(p.queryByRole("textbox", { name: "Notes" })).toBeNull();
    expect(p.queryByRole("combobox")).toBeNull();
    expect(p.queryByText("Subtasks")).toBeNull();
  });

  it("follows another selection", async () => {
    const weed = task({ title: "Weed the beds", listId: inbox.id });
    const mow = task({ title: "Mow the lawn", listId: inbox.id });
    stubApi([weed, mow]);
    const { href } = renderAt(`/inbox?task=${weed.id}`);
    const p = await inPanel();
    await p.findByDisplayValue("Weed the beds");
    await userEvent.click((await main().findByText("Mow the lawn")).closest("li")!);
    expect(href()).toBe(`/inbox?task=${mow.id}`);
    expect(await (await inPanel()).findByDisplayValue("Mow the lawn")).toBeTruthy();
  });

  it("keeps a newer label change when an older save answers first", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, labels: ["next", "outside", "quick"] });
    const { held, gate } = holdAll();
    const { fetchMock, p } = await openOn(weed, [weed], { gate });
    await userEvent.click(p.getByRole("button", { name: "Remove label next" }));
    await userEvent.click(await p.findByRole("button", { name: "Remove label outside" }));
    await waitFor(() => expect(held).toHaveLength(2));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["outside", "quick"] }, { labels: ["quick"] }]);

    held[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(p.queryByRole("button", { name: "Remove label outside" })).toBeNull();

    held[1]!.resolve();
    await waitFor(() => expect(p.getAllByRole("button", { name: /^Remove label/ }).map((b) => b.getAttribute("aria-label")))
      .toEqual(["Remove label quick"]));
    // The refetch after the last save agrees.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(p.getAllByRole("button", { name: /^Remove label/ })).toHaveLength(1);
  });

  it("doesn't let a failed older save wipe a newer pending change", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, labels: ["next", "outside", "quick"] });
    const { held, gate } = holdAll();
    const { p } = await openOn(weed, [weed], { gate });
    await userEvent.click(p.getByRole("button", { name: "Remove label next" }));
    await userEvent.click(await p.findByRole("button", { name: "Remove label outside" }));
    await waitFor(() => expect(held).toHaveLength(2));

    held[0]!.reject();
    await waitFor(() => expect(document.querySelector(".toast")?.textContent).toContain("Boom"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(p.queryByRole("button", { name: "Remove label next" })).toBeNull();
    expect(p.queryByRole("button", { name: "Remove label outside" })).toBeNull();

    held[1]!.resolve();
    await waitFor(() => expect(p.getAllByRole("button", { name: /^Remove label/ })).toHaveLength(1));
    expect(p.getByRole("button", { name: "Remove label quick" })).toBeTruthy();
  });

  it("saves a changed date once, after a pause or on leaving the field", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    const due = p.getByLabelText("Due");
    fireEvent.change(due, { target: { value: "2026-11-05" } });
    fireEvent.change(due, { target: { value: "2026-11-15" } });
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([]);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-15" }]));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(1);

    fireEvent.change(due, { target: { value: "2026-11-20" } });
    fireEvent.blur(due);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(2), { timeout: 300 });
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ dueDate: "2026-11-20" });
  });

  it("shows a failed save in the toast after the panel has closed, offering to copy the notes", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const { view, p } = await openOn(weed, [weed], { failUpdate: true });
      await userEvent.type(p.getByRole("textbox", { name: "Notes" }), "Start with the roses");
      await userEvent.keyboard("{Escape}");
      expect(view.href()).toBe(`/list/${garden.id}`);
      await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
      const toast = await screen.findByText("Boom");
      await userEvent.click(within(toast.closest(".toast")! as HTMLElement).getByRole("button", { name: "Copy notes" }));
      expect(writeText).toHaveBeenCalledWith("Start with the roses");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("adds a typed label on leaving the field or Escape", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await userEvent.type(p.getByRole("combobox", { name: "Add a label" }), "outside");
    await userEvent.tab();
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["outside"] }]);
    await userEvent.type(p.getByRole("combobox", { name: "Add a label" }), "quick");
    await userEvent.keyboard("{Escape}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ labels: ["outside", "quick"] });
  });

  it("shows the latest list chosen while earlier moves finish", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { held, gate } = holdAll();
    const { p } = await openOn(weed, [weed], { gate });
    const select = p.getByRole("combobox", { name: "List" }) as HTMLSelectElement;
    await userEvent.selectOptions(select, errands.id);
    await userEvent.selectOptions(select, projects.id);
    await waitFor(() => expect(held).toHaveLength(2));
    held[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(select.value).toBe(projects.id);
    held[1]!.resolve();
    await waitFor(() => expect(p.getByText("Saved")).toBeTruthy());
    expect(select.value).toBe(projects.id);
  });
});
