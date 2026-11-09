import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "@claudia/shared";
import { todayIn, zonedToUtc } from "../lib/dates";
import { addDays, at, errands, garden, inbox, main, projects, renderAt, sentBodies, stubApi, task, today } from "./testApi";

const quickAdd = () => main().findByRole("textbox", { name: "Add a task" }) as Promise<HTMLInputElement>;

describe("quick add", () => {
  /** Says whether the main pointer is coarse (a touch screen). */
  const pointer = (coarse: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: query === "(pointer: coarse)" ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  it("adds the task when the field is left on a touch screen (the iOS keyboard's ✓ only hides it)", async () => {
    pointer(true);
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Plant tomatoes");
    field.blur();
    await waitFor(() => expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Plant tomatoes" }]));
    expect(field.value).toBe("");
  });

  it("keeps the text without adding when the field is left with a mouse", async () => {
    pointer(false);
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Plant tomatoes");
    await userEvent.click(document.body);
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([]);
    expect(field.value).toBe("Plant tomatoes");
  });

  it("adds nothing on a touch screen when Escape clears the field or the field is left empty", async () => {
    pointer(true);
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Plant tomatoes{Escape}");
    expect(field.value).toBe("");
    await userEvent.click(field);
    field.blur();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([]);
  });

  it("keeps the field focused when the date chip's × is tapped, so nothing is added yet", async () => {
    pointer(true);
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Call Sam tomorrow");
    await userEvent.click(await main().findByRole("button", { name: "Keep “tomorrow” in the title" }));
    expect(document.activeElement).toBe(field);
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([]);
    expect(field.value).toBe("Call Sam tomorrow");
  });

  it("adds to the list being shown, at the top, and keeps focus for the next one", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    expect(field.placeholder).toBe("Add a task");
    await userEvent.type(field, "Plant tomatoes{Enter}");
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Plant tomatoes" }]);
    expect(await main().findByText("Plant tomatoes")).toBeTruthy();
    expect(main().getAllByRole("listitem").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Plant tomatoes"),
      expect.stringContaining("Weed the beds"),
    ]);
    // The task went to the list on screen, so there's nothing to announce.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("adds to the Inbox from Next with the next label and any #labels, and says where it went", async () => {
    const fetchMock = stubApi([]);
    renderAt("/next");
    await userEvent.type(await quickAdd(), "Call Sam #phone #Next about #phone the deck{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([
      { atStart: true, listId: inbox.id, title: "Call Sam about the deck", labels: ["next", "phone"] },
    ]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Added to Inbox"));
    expect(await main().findByText("Call Sam about the deck")).toBeTruthy();
  });

  it("adds the view's label in WIP, Waiting and Someday, and none in Inbox", async () => {
    for (const [path, label] of [["/wip", "wip"], ["/waiting", "waitingOn"], ["/someday", "someday"], ["/inbox", undefined]] as const) {
      const fetchMock = stubApi([]);
      const { unmount } = renderAt(path);
      await userEvent.type(await quickAdd(), "Sort the post{Enter}");
      expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([
        { atStart: true, listId: inbox.id, title: "Sort the post", ...(label ? { labels: [label] } : {}) },
      ]);
      unmount();
    }
  });

  it("adds to the Inbox due today from Today", async () => {
    const fetchMock = stubApi([]);
    renderAt("/today");
    await userEvent.type(await quickAdd(), "Pay the rent{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: inbox.id, title: "Pay the rent", dueDate: today }]);
    expect(await main().findByText("Pay the rent")).toBeTruthy();
  });

  it("uses the day it is when the task is added, not when the screen was shown", async () => {
    // 11 pm in Sydney on 2 November, then just past midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
      const fetchMock = stubApi([]);
      renderAt("/today");
      const field = await quickAdd();
      vi.setSystemTime(new Date("2026-11-02T13:30:00.000Z"));
      await userEvent.type(field, "Pay the rent{Enter}");
      expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: inbox.id, title: "Pay the rent", dueDate: "2026-11-03" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds to the Inbox from a saved filter, with nothing extra", async () => {
    const errand: Filter = { id: "01JD0000000000000000000001", name: "Errands", query: "label=errand", position: "a0", createdAt: at, updatedAt: at };
    const fetchMock = stubApi([], { filters: [errand] });
    renderAt(`/filter/${errand.id}`);
    await userEvent.type(await quickAdd(), "Buy stamps #errand{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: inbox.id, title: "Buy stamps", labels: ["errand"] }]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Added to Inbox"));
  });

  it("is hidden on views when there's no Inbox list, but not on list screens", async () => {
    stubApi([task({ title: "Buy stamps", listId: errands.id, labels: ["next"] })], { lists: [errands, projects, garden] });
    const { unmount } = renderAt("/next");
    expect(await main().findByText("Buy stamps")).toBeTruthy();
    expect(main().queryByRole("textbox", { name: "Add a task" })).toBeNull();
    unmount();
    renderAt(`/list/${errands.id}`);
    expect(await quickAdd()).toBeTruthy();
  });

  it("does nothing for empty text", async () => {
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.type(await quickAdd(), "   {Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([]);
  });

  it("clears and leaves the field on Escape", async () => {
    stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Half a thought{Escape}");
    expect(field.value).toBe("");
    expect(document.activeElement).not.toBe(field);
  });

  it("shows the error and puts the text back when adding fails", async () => {
    stubApi([], { failCreate: true });
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Plant tomatoes #spring{Enter}");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(field.value).toBe("Plant tomatoes #spring");
  });
});

describe("dates in quick add", () => {
  const tz = "Australia/Sydney";
  // 11 am on Monday 2 November in Sydney.
  const fixClock = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    return todayIn(tz);
  };
  afterEach(() => vi.useRealTimers());

  it("a date at the end sets the due date", async () => {
    const day = fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Call Sam tomorrow");
    expect(main().getByText("Due Tomorrow")).toBeTruthy();
    await userEvent.type(field, "{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Call Sam", dueDate: addDays(day, 1) }]);
    expect(main().queryByText(/^Due /)).toBeNull();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Added, due Tomorrow"));
  });

  it("a time sets dueAt", async () => {
    const day = fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.type(await quickAdd(), "Call Sam tomorrow 3pm{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([
      { atStart: true, listId: garden.id, title: "Call Sam", dueAt: zonedToUtc(addDays(day, 1), "15:00", tz) },
    ]);
  });

  it("updates the preview as you type", async () => {
    fixClock();
    stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Call Sam tomorrow");
    expect(main().getByText("Due Tomorrow")).toBeTruthy();
    await userEvent.type(field, " 3pm");
    expect(main().getByText("Due Tomorrow, 3:00 pm")).toBeTruthy();
    expect(main().queryByText("Due Tomorrow")).toBeNull();
  });

  it("the preview's × keeps the words", async () => {
    fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Read chapter 3/4");
    expect(main().getByText(/^Due /)).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Keep “3/4” in the title" }));
    expect(main().queryByText(/^Due /)).toBeNull();
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Read chapter 3/4" }]);
    // The dismissal was for that entry only.
    await userEvent.type(field, "Read chapter 3/4");
    expect(main().getByText(/^Due /)).toBeTruthy();
  });

  it("clears the dismissal with the field on Escape", async () => {
    fixClock();
    stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Read chapter 3/4");
    await userEvent.click(main().getByRole("button", { name: "Keep “3/4” in the title" }));
    await userEvent.type(field, "{Escape}");
    await userEvent.type(field, "Read chapter 3/4");
    expect(main().getByText(/^Due /)).toBeTruthy();
  });

  it("forgets the dismissal once its words are gone", async () => {
    const day = fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Buy tomorrow");
    await userEvent.click(main().getByRole("button", { name: "Keep “tomorrow” in the title" }));
    await userEvent.type(field, "{Control>}a{/Control}{Backspace}");
    expect(field.value).toBe("");
    await userEvent.type(field, "Call Sam tomorrow");
    expect(main().getByText("Due Tomorrow")).toBeTruthy();
    await userEvent.type(field, "{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Call Sam", dueDate: addDays(day, 1) }]);
  });

  it("describes the field with the preview while it shows", async () => {
    fixClock();
    stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    expect(field.getAttribute("aria-describedby")).toBeNull();
    await userEvent.type(field, "Call Sam tomorrow");
    const id = field.getAttribute("aria-describedby");
    expect(id && document.getElementById(id)?.textContent).toBe("Due Tomorrow");
    expect(document.getElementById(id!)?.closest("[aria-live]")).toBeNull();
    await userEvent.type(field, "{Enter}");
    expect(field.getAttribute("aria-describedby")).toBeNull();
  });

  it("marks a preview that has already passed as overdue", async () => {
    fixClock();
    stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.type(await quickAdd(), "Call Sam today 9am");
    const preview = main().getByText("Due Today, 9:00 am");
    expect(preview.closest(".quick-add-when")?.classList.contains("overdue")).toBe(true);
    expect(preview.textContent).toBe("Due Today, 9:00 am (overdue)");
  });

  it("keeps the dismissal when adding fails", async () => {
    fixClock();
    stubApi([], { failCreate: true });
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Read chapter 3/4");
    await userEvent.click(main().getByRole("button", { name: "Keep “3/4” in the title" }));
    await userEvent.type(field, "{Enter}");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(field.value).toBe("Read chapter 3/4");
    expect(main().queryByText(/^Due /)).toBeNull();
  });

  it("labels and a date together", async () => {
    fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.type(await quickAdd(), "Pay rent #home 1 Dec{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([
      { atStart: true, listId: garden.id, title: "Pay rent", labels: ["home"], dueDate: "2026-12-01" },
    ]);
  });

  it("on Today a parsed date wins over today", async () => {
    const day = fixClock();
    const fetchMock = stubApi([]);
    renderAt("/today");
    await userEvent.type(await quickAdd(), "Call Sam tomorrow{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: inbox.id, title: "Call Sam", dueDate: addDays(day, 1) }]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Added to Inbox, due Tomorrow"));
  });

  it("text that is only a date is the title", async () => {
    fixClock();
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    const field = await quickAdd();
    await userEvent.type(field, "Tomorrow");
    expect(main().queryByText(/^Due /)).toBeNull();
    await userEvent.type(field, "{Enter}");
    expect(sentBodies(fetchMock, "POST", "/api/tasks")).toEqual([{ atStart: true, listId: garden.id, title: "Tomorrow" }]);
  });
});

describe("inline title editing", () => {
  it("edits a title in place on a double click and saves on Enter", async () => {
    const t = task({ title: "Plant tomatoes", listId: garden.id });
    const fetchMock = stubApi([t]);
    renderAt(`/list/${garden.id}`);
    await userEvent.dblClick(await main().findByRole("button", { name: "Plant tomatoes" }));
    const input = main().getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(input.value).toBe("Plant tomatoes");
    expect(document.activeElement).toBe(input);
    await userEvent.clear(input);
    await userEvent.type(input, "Plant cherry tomatoes{Enter}");
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(main().getByRole("button", { name: "Plant cherry tomatoes" })).toBeTruthy();
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toEqual([{ title: "Plant cherry tomatoes" }]);
  });

  it("opens with Enter on the focused title and saves on blur", async () => {
    const t = task({ title: "Plant tomatoes", listId: garden.id });
    const fetchMock = stubApi([t]);
    renderAt(`/list/${garden.id}`);
    (await main().findByRole("button", { name: "Plant tomatoes" })).focus();
    await userEvent.keyboard("{Enter}");
    const input = main().getByRole("textbox", { name: "Title" });
    await userEvent.type(input, " and basil");
    await userEvent.click(main().getByRole("heading", { level: 1 }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toEqual([{ title: "Plant tomatoes and basil" }]);
  });

  it("cancels on Escape and doesn't save unchanged or empty titles", async () => {
    const t = task({ title: "Plant tomatoes", listId: garden.id });
    const fetchMock = stubApi([t]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByRole("button", { name: "Plant tomatoes" });

    await userEvent.dblClick(title);
    await userEvent.type(main().getByRole("textbox", { name: "Title" }), " later{Escape}");
    expect(main().getByRole("button", { name: "Plant tomatoes" })).toBeTruthy();

    await userEvent.dblClick(main().getByRole("button", { name: "Plant tomatoes" }));
    await userEvent.keyboard("{Enter}");
    await userEvent.dblClick(main().getByRole("button", { name: "Plant tomatoes" }));
    await userEvent.clear(main().getByRole("textbox", { name: "Title" }));
    await userEvent.keyboard("{Enter}");
    expect(main().getByRole("button", { name: "Plant tomatoes" })).toBeTruthy();
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toEqual([]);
  });

  it("puts the old title back and shows the error when saving fails", async () => {
    stubApi([task({ title: "Plant tomatoes", listId: garden.id })], { failUpdate: true });
    renderAt(`/list/${garden.id}`);
    await userEvent.dblClick(await main().findByRole("button", { name: "Plant tomatoes" }));
    await userEvent.type(main().getByRole("textbox", { name: "Title" }), " now{Enter}");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(main().getByRole("button", { name: "Plant tomatoes" })).toBeTruthy();
  });

  it("keeps the checkbox working beside an editable title", async () => {
    stubApi([task({ title: "Plant tomatoes", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Plant tomatoes" }));
    expect(main().queryByRole("button", { name: "Plant tomatoes" })).toBeNull();
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
  });
});
