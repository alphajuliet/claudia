import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@claudia/shared";
import { formatDue, formatWhen, splitIn, todayIn, zonedToUtc } from "../lib/dates";
import { addDays, errands, garden, inbox, main, projects, renderAt, sentBodies, stubApi, task, today } from "./testApi";

const tz = "Australia/Sydney";

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

/** Unfolds the panel's Due, Snooze and Start fields, which show only what is set until clicked. */
async function unfoldDates(p: ReturnType<typeof within>) {
  for (const name of ["due date", "snooze", "start date"]) await userEvent.click(p.getByRole("button", { name: `Change ${name}` }));
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

  it("selects without renaming when the title is clicked, and not when the checkbox is", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    stubApi([weed]);
    const { href } = renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByText("Weed the beds"));
    expect(href()).toBe(`/list/${garden.id}?task=${weed.id}`);
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
    await inPanel();
  });

  it("closes with the Done button or Escape in the panel, keeping the path", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { view, p } = await openOn(weed);
    await userEvent.click(p.getByRole("button", { name: "Done" }));
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
    await userEvent.click(p.getByRole("button", { name: "Done" }));
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
    await unfoldDates(p);
    const due = within(p.getByRole("group", { name: "Due" }));
    fireEvent.change(due.getByLabelText("Due date"), { target: { value: "2026-11-05" } });
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-05", dueAt: null }]));
    await userEvent.click(await p.findByRole("button", { name: "Clear due date" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ dueDate: null, dueAt: null });
  });

  it("a quick button sets the day and keeps the time", async () => {
    const call = task({ title: "Call Sam", listId: garden.id, dueAt: "2026-11-03T08:00:00.000Z" });
    const { fetchMock, p } = await openOn(call);
    await unfoldDates(p);
    await userEvent.click(within(p.getByRole("group", { name: "Due" })).getByRole("button", { name: "Due: Tomorrow" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${call.id}`)).toEqual([
      { dueDate: null, dueAt: zonedToUtc(addDays(today, 1), "19:00", tz) },
    ]);
  });

  it("adding a time moves the date to dueAt", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, dueDate: "2026-11-05" });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const time = p.getByLabelText("Due time");
    fireEvent.change(time, { target: { value: "09:30" } });
    fireEvent.blur(time);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: null, dueAt: zonedToUtc("2026-11-05", "09:30", tz) }]));
  });

  it("a time with no due date is today", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const time = p.getByLabelText("Due time");
    fireEvent.change(time, { target: { value: "09:30" } });
    fireEvent.blur(time);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: null, dueAt: zonedToUtc(today, "09:30", tz) }]));
  });

  it("clearing the time keeps the day", async () => {
    const call = task({ title: "Call Sam", listId: garden.id, dueAt: "2026-11-03T08:00:00.000Z" });
    const { fetchMock, p } = await openOn(call);
    await unfoldDates(p);
    const time = p.getByLabelText("Due time");
    fireEvent.change(time, { target: { value: "" } });
    fireEvent.blur(time);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${call.id}`)).toEqual([{ dueDate: "2026-11-03", dueAt: null }]));
  });

  it("snoozes with a quick choice, closes the panel and offers Undo", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, view, p } = await openOn(weed);
    await unfoldDates(p);
    await userEvent.click(within(p.getByRole("group", { name: "Snooze" })).getByRole("button", { name: "Snooze: Tomorrow" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ snoozedUntil: zonedToUtc(addDays(today, 1), "00:00", tz) }]));
    expect(view.href()).toBe(`/list/${garden.id}`);
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Snoozed “Weed the beds” until Tomorrow"));
    expect(main().queryByText("Weed the beds")).toBeNull();
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ snoozedUntil: null }));
    expect(await main().findByText("Weed the beds")).toBeTruthy();
  });

  it("says so when undoing a snooze fails", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    let patches = 0;
    const { p } = await openOn(weed, [weed], { gate: () => (++patches > 1 ? Promise.reject(new Error("no")) : undefined) });
    await unfoldDates(p);
    await userEvent.click(within(p.getByRole("group", { name: "Snooze" })).getByRole("button", { name: "Snooze: Tomorrow" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Snoozed “Weed the beds” until Tomorrow"));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    await waitFor(() => expect(main().queryByText("Weed the beds")).toBeNull());
  });

  it("puts the row back when a snooze fails after the panel has closed", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { view, p } = await openOn(weed, [weed], { failUpdate: true });
    await unfoldDates(p);
    await userEvent.click(within(p.getByRole("group", { name: "Snooze" })).getByRole("button", { name: "Snooze: Tomorrow" }));
    expect(view.href()).toBe(`/list/${garden.id}`);
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(screen.getByRole("status").textContent).not.toContain("Snoozed “Weed the beds” until");
    expect(await main().findByText("Weed the beds")).toBeTruthy();
  });

  it("a typed snooze saves with Undo but keeps the panel open", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, view, p } = await openOn(weed);
    await unfoldDates(p);
    const day = addDays(todayIn(tz), 3);
    const date = within(p.getByRole("group", { name: "Snooze" })).getByLabelText("Snooze date");
    fireEvent.change(date, { target: { value: day } });
    fireEvent.blur(date);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ snoozedUntil: zonedToUtc(day, "00:00", tz) }]));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(`Snoozed “Weed the beds” until ${formatDue(day, todayIn(tz)).text}`));
    expect(view.href()).toBe(`/list/${garden.id}?task=${weed.id}`);
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeTruthy();
  });

  it("an Undo for a snooze since changed does nothing", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const snooze = within(p.getByRole("group", { name: "Snooze" }));
    const date = snooze.getByLabelText("Snooze date");
    fireEvent.change(date, { target: { value: addDays(todayIn(tz), 3) } });
    fireEvent.blur(date);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Snoozed “Weed the beds” until"));
    await userEvent.click(await snooze.findByRole("button", { name: "Clear snooze" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(2));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(2);
  });

  it("doesn't save a snooze for today with no time, which has passed", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const date = within(p.getByRole("group", { name: "Snooze" })).getByLabelText("Snooze date");
    fireEvent.change(date, { target: { value: todayIn(tz) } });
    fireEvent.blur(date);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("That time has passed"));
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([]);
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeTruthy();
  });

  describe("snooze choices", () => {
    afterEach(() => vi.useRealTimers());
    /** Sets the clock to a wall-clock time in Sydney. */
    const at = (date: string, time: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(zonedToUtc(date, time, tz)));
    };
    const choices = async () => {
      const { fetchMock, p } = await openOn(task({ title: "Weed the beds", listId: garden.id }));
      await unfoldDates(p);
      const snooze = within(p.getByRole("group", { name: "Snooze" }));
      const names = snooze.getAllByRole("button").map((b) => b.getAttribute("aria-label")).filter((n) => n?.startsWith("Snooze: "));
      return { fetchMock, p, snooze, names };
    };

    it("on a weekday before 6 pm offers This evening, Tomorrow, This weekend and Next week", async () => {
      at("2026-11-04", "17:59");
      const { fetchMock, snooze, names } = await choices();
      expect(names).toEqual(["Snooze: This evening", "Snooze: Tomorrow", "Snooze: This weekend", "Snooze: Next week"]);
      expect(snooze.queryByRole("button", { name: "Snooze: Today" })).toBeNull();
      expect((snooze.getByLabelText("Snooze time") as HTMLInputElement).disabled).toBe(false);
      await userEvent.click(snooze.getByRole("button", { name: "Snooze: This evening" }));
      const sent = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init!.body)) as unknown);
      await waitFor(() => expect(sent()).toEqual([{ snoozedUntil: zonedToUtc(todayIn(tz), "18:00", tz) }]));
    });

    it("from 6 pm has no This evening", async () => {
      at("2026-11-04", "18:00");
      const { names } = await choices();
      expect(names).toEqual(["Snooze: Tomorrow", "Snooze: This weekend", "Snooze: Next week"]);
    });

    it("on a Saturday has no This weekend", async () => {
      at("2026-11-07", "10:00");
      const { names } = await choices();
      expect(names).toEqual(["Snooze: This evening", "Snooze: Tomorrow", "Snooze: Next week"]);
    });

    it("doesn't save This evening clicked after 6 pm", async () => {
      at("2026-11-04", "17:59");
      const { fetchMock, snooze } = await choices();
      vi.setSystemTime(new Date(zonedToUtc("2026-11-04", "18:01", tz)));
      await userEvent.click(snooze.getByRole("button", { name: "Snooze: This evening" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("That time has passed"));
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toEqual([]);
      expect(screen.getByRole("complementary", { name: "Task details" })).toBeTruthy();
    });
  });

  it("a past snooze shows as none", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, snoozedUntil: "2020-01-01T00:00:00.000Z" });
    const { p } = await openOn(weed);
    const snooze = within(p.getByRole("group", { name: "Snooze" }));
    expect(snooze.getByText("None")).toBeTruthy();
    expect(snooze.queryByRole("button", { name: "Clear snooze" })).toBeNull();
  });

  it("a snoozed task shows its snooze with Clear", async () => {
    const snoozedUntil = zonedToUtc(addDays(today, 3), "00:00", tz);
    const weed = task({ title: "Weed the beds", listId: garden.id, snoozedUntil });
    const { fetchMock, view, p } = await openOn(weed);
    const snooze = within(p.getByRole("group", { name: "Snooze" }));
    expect(snooze.getByText(formatWhen({ date: addDays(today, 3), time: null }, today, "00:00").text)).toBeTruthy();
    await userEvent.click(snooze.getByRole("button", { name: "Clear snooze" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ snoozedUntil: null }]));
    expect(view.href()).toBe(`/list/${garden.id}?task=${weed.id}`);
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeTruthy();
  });

  it("shows the start date after Due and Snooze, and clears it", async () => {
    const startDate = addDays(today, 9);
    const weed = task({ title: "Weed the beds", listId: garden.id, startDate });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const start = within(p.getByRole("group", { name: "Start" }));
    expect(start.getByText(formatDue(startDate, today).text)).toBeTruthy();
    expect((p.getByLabelText("Start date") as HTMLInputElement).value).toBe(startDate);
    const names = p.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent);
    expect(names.filter((n) => n === "Due" || n === "Snooze" || n === "Start")).toEqual(["Due", "Snooze", "Start"]);
    await userEvent.click(start.getByRole("button", { name: "Clear start date" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ startDate: null }]);
  });

  it("sets the start date from a quick choice or the date input, with no time", async () => {
    const plain = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(plain);
    await unfoldDates(p);
    const start = within(p.getByRole("group", { name: "Start" }));
    expect(start.getByText("None")).toBeTruthy();
    expect(p.queryByLabelText("Start time")).toBeNull();
    await userEvent.click(start.getByRole("button", { name: "Start: Today" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${plain.id}`)).toEqual([{ startDate: today }]);
    // The quick choice folded it again.
    await userEvent.click(start.getByRole("button", { name: "Change start date" }));
    fireEvent.change(p.getByLabelText("Start date"), { target: { value: "2026-12-24" } });
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${plain.id}`)).toEqual([{ startDate: today }, { startDate: "2026-12-24" }]));
  });

  it("hints at empty date and time inputs only", async () => {
    const plain = task({ title: "Weed the beds", listId: garden.id, dueDate: "2026-11-05" });
    const { p } = await openOn(plain);
    await unfoldDates(p);
    const hint = (label: string) => p.getByLabelText(label).parentElement!.getAttribute("data-hint");
    expect(hint("Due date")).toBeNull();
    expect(hint("Due time")).toBe("Time");
    expect(hint("Snooze date")).toBe("Date");
  });

  it("shows a due time", async () => {
    const dueAt = "2026-11-03T08:00:00.000Z";
    const call = task({ title: "Call Sam", listId: garden.id, dueAt });
    const { p } = await openOn(call);
    const shown = formatWhen(splitIn(dueAt, tz), today, splitIn(new Date().toISOString(), tz).time);
    // The row's label already says Due.
    expect(p.getByRole("group", { name: "Due" }).textContent).toContain(shown.text);
  });

  it("changing a repeating task's day drops its due time", async () => {
    const call = task({ title: "Call Sam", listId: garden.id, dueAt: "2026-11-03T08:00:00.000Z", recurRule: "FREQ=WEEKLY", recurFrom: "due" });
    const { fetchMock, p } = await openOn(call);
    await unfoldDates(p);
    await userEvent.click(within(p.getByRole("group", { name: "Due" })).getByRole("button", { name: "Due: Tomorrow" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${call.id}`)).toEqual([{ dueDate: addDays(today, 1), dueAt: null }]);
  });

  it("a repeating task can't take a time", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id, dueDate: "2026-11-05", recurRule: "FREQ=WEEKLY", recurFrom: "due" });
    const { p } = await openOn(weed);
    await unfoldDates(p);
    const time = p.getByLabelText("Due time") as HTMLInputElement;
    expect(time.disabled).toBe(true);
    expect(p.getByText("Times on repeating tasks are coming")).toBeTruthy();
    expect(time.getAttribute("aria-describedby")).toBe(p.getByText("Times on repeating tasks are coming").id);
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
    await unfoldDates(p);
    const due = p.getByLabelText("Due date");
    fireEvent.change(due, { target: { value: "2026-11-05" } });
    fireEvent.change(due, { target: { value: "2026-11-15" } });
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([]);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-15", dueAt: null }]));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(1);

    fireEvent.change(due, { target: { value: "2026-11-20" } });
    fireEvent.blur(due);
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(2), { timeout: 300 });
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ dueDate: "2026-11-20", dueAt: null });
  });

  it("doesn't save a date whose year is still being typed", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    const due = p.getByLabelText("Due date");
    fireEvent.change(due, { target: { value: "0202-11-05" } });
    fireEvent.blur(due);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([]);
  });

  it("saves a date still waiting when the panel closes", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { fetchMock, p } = await openOn(weed);
    await unfoldDates(p);
    fireEvent.change(p.getByLabelText("Due date"), { target: { value: "2026-11-05" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-05", dueAt: null }]));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(1);
  });

  it("keeps a waiting date on its own task when the selection changes", async () => {
    const weed = task({ title: "Weed the beds", listId: inbox.id });
    const mow = task({ title: "Mow the lawn", listId: inbox.id, dueDate: "2026-11-20" });
    const fetchMock = stubApi([weed, mow]);
    renderAt(`/inbox?task=${weed.id}`);
    const p = await inPanel();
    await p.findByDisplayValue("Weed the beds");
    await unfoldDates(p);
    fireEvent.change(p.getByLabelText("Due date"), { target: { value: "2026-11-05" } });
    await userEvent.click((await main().findByText("Mow the lawn")).closest("li")!);
    const q = await inPanel();
    await q.findByDisplayValue("Mow the lawn");
    await unfoldDates(q);
    expect((q.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-11-20");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ dueDate: "2026-11-05", dueAt: null }]);
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${mow.id}`)).toEqual([]);
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
    // The first Escape closes the list of labels, the second the panel, saving the typed one.
    await userEvent.keyboard("{Escape}");
    expect(p.getByRole("combobox", { name: "Add a label" }).getAttribute("aria-expanded")).toBe("false");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ labels: ["outside", "quick"] });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull());
  });

  describe("label list", () => {
    const labels = ["outside", "Quick", "errand", "next", "readReview"];
    const field = (p: Awaited<ReturnType<typeof inPanel>>) => p.getByRole("combobox", { name: "Add a label" });
    const optionNames = (p: Awaited<ReturnType<typeof inPanel>>) => (p.queryByRole("listbox", { name: "Labels" }) ? within(p.getByRole("listbox", { name: "Labels" })).queryAllByRole("option") : []).map((o) => o.textContent);

    it("lists the labels not on the task, alphabetically, when the field is tapped", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id, labels: ["next"] });
      const { p } = await openOn(weed, [weed], { labels });
      expect(field(p).getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(field(p));
      await waitFor(() => expect(optionNames(p)).toEqual(["errand", "outside", "Quick", "readReview"]));
      expect(field(p).getAttribute("aria-expanded")).toBe("true");
      // A press in the list's gaps or on its scroll bar doesn't take focus from the field.
      expect(fireEvent.mouseDown(p.getByRole("listbox", { name: "Labels" }))).toBe(false);
    });

    it("filters as you type and offers to create a new name", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { p } = await openOn(weed, [weed], { labels });
      await userEvent.type(field(p), "RE");
      await waitFor(() => expect(optionNames(p)).toEqual(["readReview", "Create “RE”"]));
      await userEvent.type(field(p), "adreview");
      expect(optionNames(p)).toEqual(["readReview"]);
    });

    it("adds a label tapped in the list and stays open for another", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { fetchMock, p } = await openOn(weed, [weed], { labels });
      await userEvent.click(field(p));
      await userEvent.click(await p.findByRole("option", { name: "outside" }));
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["outside"] }]);
      expect(document.activeElement).toBe(field(p));
      await waitFor(() => expect(optionNames(p)).toEqual(["errand", "next", "Quick", "readReview"]));
      await userEvent.click(p.getByRole("option", { name: "Quick" }));
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`).at(-1)).toEqual({ labels: ["outside", "Quick"] });
    });

    it("moves through the list with the arrow keys and adds the highlighted label with Enter", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { fetchMock, p } = await openOn(weed, [weed], { labels });
      await userEvent.type(field(p), "e");
      await userEvent.keyboard("{ArrowDown}{ArrowDown}");
      const active = field(p).getAttribute("aria-activedescendant");
      expect(document.getElementById(active!)?.textContent).toBe("next");
      expect(p.getByRole("option", { name: "next" }).getAttribute("aria-selected")).toBe("true");
      await userEvent.keyboard("{Enter}");
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["next"] }]);
      expect(field(p)).toHaveProperty("value", "");
    });

    it("adds a typed name in the label's own case", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { fetchMock, p } = await openOn(weed, [weed], { labels });
      await userEvent.type(field(p), "quick{Enter}");
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["Quick"] }]);
    });

    it("creates a new label from its option", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { fetchMock, p } = await openOn(weed, [weed], { labels });
      await userEvent.type(field(p), "#shed");
      await userEvent.click(await p.findByRole("option", { name: "Create “shed”" }));
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${weed.id}`)).toEqual([{ labels: ["shed"] }]);
    });

    it("puts the name back in the field when the save fails", async () => {
      const weed = task({ title: "Weed the beds", listId: garden.id });
      const { p } = await openOn(weed, [weed], { labels, failUpdate: true });
      await userEvent.click(field(p));
      await userEvent.click(await p.findByRole("option", { name: "errand" }));
      await waitFor(() => expect(field(p)).toHaveProperty("value", "errand"));
    });
  });

  it("shows the latest list chosen while earlier moves finish", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    const { held, gate } = holdAll();
    const { p } = await openOn(weed, [weed], { gate });
    const select = p.getByRole("combobox", { name: "List" }) as HTMLSelectElement;
    await userEvent.selectOptions(select, errands.id);
    await userEvent.selectOptions(select, projects.id);
    // Moves go one at a time: the second waits for the first.
    await waitFor(() => expect(held).toHaveLength(1));
    expect(select.value).toBe(projects.id);
    held[0]!.resolve();
    await waitFor(() => expect(held).toHaveLength(2));
    expect(select.value).toBe(projects.id);
    held[1]!.resolve();
    await waitFor(() => expect(p.getByText("Saved")).toBeTruthy());
    expect(select.value).toBe(projects.id);
  });

  it("closes when the selected task is completed, without saying it no longer exists", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    let release!: () => void;
    const { view } = await openOn(weed, [weed], { holdComplete: new Promise<void>((resolve) => { release = resolve; }) });
    await userEvent.click(main().getByRole("checkbox", { name: "Complete Weed the beds" }));
    expect(screen.queryByText("This task no longer exists.")).toBeNull();
    await waitFor(() => expect(view.href()).toBe(`/list/${garden.id}`));
    release();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Completed “Weed the beds”"));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("selects a heading from its section title", async () => {
    const heading = task({ title: "Spring", listId: garden.id, kind: "heading" });
    stubApi([heading, task({ title: "Plant tomatoes", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    const title = await main().findByRole("button", { name: "Spring" });
    expect(title.closest("h2")).toBeTruthy();
    await userEvent.click(title);
    expect(href()).toBe(`/list/${garden.id}?task=${heading.id}`);
    const p = await inPanel();
    expect(await p.findByDisplayValue("Spring")).toBeTruthy();
    expect(p.getByRole("button", { name: "Delete heading" })).toBeTruthy();
  });
});

describe("the sheet and the keyboard", () => {
  /** A stand-in for `window.visualViewport`: an event target whose size the test sets. */
  function stubViewport(height: number) {
    const vv = Object.assign(new EventTarget(), { height, offsetTop: 0 });
    vi.stubGlobal("visualViewport", vv);
    return vv;
  }
  function stubNarrow(matches = true) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it("sizes the sheet to the visible viewport on narrow screens, following its resizes", async () => {
    const vv = stubViewport(500);
    stubNarrow();
    await openOn(task({ title: "Weed the beds", listId: garden.id }));
    const aside = await panel();
    expect(aside.style.height).toBe("500px");
    expect(aside.style.top).toBe("0px");
    act(() => {
      Object.assign(vv, { height: 300, offsetTop: 40 });
      vv.dispatchEvent(new Event("resize"));
    });
    expect(aside.style.height).toBe("300px");
    expect(aside.style.top).toBe("40px");
  });

  it("leaves the panel's size alone on wide screens", async () => {
    stubViewport(500);
    stubNarrow(false);
    await openOn(task({ title: "Weed the beds", listId: garden.id }));
    expect((await panel()).style.height).toBe("");
  });

  it("sets no height where there's no visualViewport", async () => {
    vi.stubGlobal("visualViewport", undefined);
    stubNarrow();
    await openOn(task({ title: "Weed the beds", listId: garden.id }));
    expect((await panel()).style.height).toBe("");
  });

  it("scrolls a field that takes focus into view", async () => {
    stubNarrow();
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const { p } = await openOn(task({ title: "Weed the beds", listId: garden.id }));
      fireEvent.focusIn(p.getByRole("textbox", { name: "Add a subtask" }));
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest" }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  describe("the folding date fields", () => {
    const dueGroup = async () => within(await screen.findByRole("group", { name: "Due" }));

    it("shows only what is set until clicked, and a quick choice folds it again", async () => {
      const t = task({ title: "Weed the beds", listId: garden.id, dueDate: "2026-12-25" });
      const fetchMock = stubApi([t]);
      renderAt(`/list/${garden.id}?task=${t.id}`);
      const due = await dueGroup();
      expect(due.queryByRole("button", { name: "Due: Tomorrow" })).toBeNull();
      expect(due.queryByLabelText("Due date")).toBeNull();
      expect(due.getByRole("button", { name: "Clear due date" })).toBeTruthy();
      const toggle = due.getByRole("button", { name: "Change due date" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(due.getByLabelText("Due date")).toBeTruthy();
      await userEvent.click(due.getByRole("button", { name: "Due: Tomorrow" }));
      await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toHaveLength(1));
      expect(due.queryByRole("button", { name: "Due: Tomorrow" })).toBeNull();
    });

    it("stays open after a typed date, for a time to follow", async () => {
      const t = task({ title: "Weed the beds", listId: garden.id });
      stubApi([t]);
      renderAt(`/list/${garden.id}?task=${t.id}`);
      const due = await dueGroup();
      await userEvent.click(due.getByRole("button", { name: "Change due date" }));
      fireEvent.change(due.getByLabelText("Due date"), { target: { value: "2026-12-25" } });
      expect(due.getByLabelText("Due time")).toBeTruthy();
    });

    it("folds on Escape, saving what was typed, and keeps the panel open", async () => {
      const t = task({ title: "Weed the beds", listId: garden.id });
      const fetchMock = stubApi([t]);
      renderAt(`/list/${garden.id}?task=${t.id}`);
      const due = await dueGroup();
      const toggle = due.getByRole("button", { name: "Change due date" });
      await userEvent.click(toggle);
      const date = due.getByLabelText("Due date");
      date.focus();
      fireEvent.change(date, { target: { value: "2026-12-25" } });
      await userEvent.keyboard("{Escape}");
      expect(due.queryByLabelText("Due date")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
      expect(screen.getByRole("complementary", { name: "Task details" })).toBeTruthy();
      await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toEqual([{ dueDate: "2026-12-25", dueAt: null }]));
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toHaveLength(1);

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull());
    });
  });
});
