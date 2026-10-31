import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, inbox, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
const panel = () => screen.queryByRole("complementary", { name: "Task details" });

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

describe("the keyboard highlight", () => {
  it("moves with j and k and wraps at both ends", async () => {
    threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Weed the beds"));
    expect(row("Weed the beds").classList).toContain("highlighted");
    await userEvent.keyboard("k");
    expect(document.activeElement).toBe(row("Mulch the roses"));
    expect(row("Weed the beds").classList).not.toContain("highlighted");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Weed the beds"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
  });

  it("starts from the last row on k", async () => {
    threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("k");
    expect(document.activeElement).toBe(row("Mulch the roses"));
  });

  it("opens the panel on Enter, follows the highlight while open without adding history, and gives focus back on Escape", async () => {
    const { tasks, href, location } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j{Enter}");
    expect(href()).toBe(`/list/${garden.id}?task=${tasks[0]!.id}`);
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveProperty("value", "Weed the beds");
    const entries = location.history!.length;

    // Focus went to the panel; j still moves the highlight, and the panel follows.
    await userEvent.keyboard("j");
    expect(href()).toBe(`/list/${garden.id}?task=${tasks[1]!.id}`);
    expect(location.history!.length).toBe(entries);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Plant tomatoes"));
    expect(document.activeElement).toBe(row("Plant tomatoes"));

    await userEvent.keyboard("{Escape}");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(row("Plant tomatoes"));
  });

  it("starts from the open task", async () => {
    const tasks = [task({ title: "Weed the beds", listId: garden.id }), task({ title: "Plant tomatoes", listId: garden.id })];
    stubApi(tasks);
    renderAt(`/list/${garden.id}?task=${tasks[1]!.id}`);
    await main().findByText("Plant tomatoes");
    await screen.findByRole("textbox", { name: "Title" });
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
  });

  it("gives focus back to the row when the panel's Close button is used", async () => {
    const { tasks } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.click(row("Plant tomatoes"));
    expect(panel()).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(row("Plant tomatoes"));
    expect(tasks).toHaveLength(3);
  });

  it("completes with x and passes the highlight to the next row", async () => {
    const { tasks, fetchMock } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jj");
    await userEvent.keyboard("x");
    expect(fetchMock.mock.calls.some(([p, init]) => p === `/api/tasks/${tasks[1]!.id}/complete` && init?.method === "POST")).toBe(true);
    await waitFor(() => expect(main().queryByText("Plant tomatoes")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row("Mulch the roses")));
    expect(row("Mulch the roses").classList).toContain("highlighted");
  });

  it("renames with e", async () => {
    const { fetchMock, tasks } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j");
    await userEvent.keyboard("e");
    const field = main().getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, "Weed the paths{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${tasks[0]!.id}`)).toEqual([{ title: "Weed the paths" }]);
  });

  it("goes to quick add with c, without typing the c", async () => {
    threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("c");
    const field = main().getByRole("textbox", { name: "Add a task" }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("");
  });

  it("leaves Enter on a focused title to edit it", async () => {
    threeTasks();
    await main().findByText("Weed the beds");
    main().getByRole("button", { name: "Plant tomatoes" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(main().getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(panel()).toBeNull();
  });

  it("moves through headings too", async () => {
    stubApi([
      task({ title: "Weed the beds", listId: garden.id }),
      task({ title: "Spring", listId: garden.id, kind: "heading" }),
      task({ title: "Plant bulbs", listId: garden.id }),
    ]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(main().getByRole("button", { name: "Spring" }));
    // Headings can't be completed.
    await userEvent.keyboard("x");
    expect(main().getByRole("button", { name: "Spring" })).toBeTruthy();
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Plant bulbs"));
  });

  it("completes once when x is held down", async () => {
    const { fetchMock } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j{x>4/}");
    await waitFor(() => expect(main().queryByText("Weed the beds")).toBeNull());
    const completes = fetchMock.mock.calls.filter(([p, init]) => String(p).endsWith("/complete") && init?.method === "POST");
    expect(completes).toHaveLength(1);
    expect(main().getByText("Plant tomatoes")).toBeTruthy();
  });

  it("passes the highlight back to the previous row when the last one is completed", async () => {
    threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("kx");
    await waitFor(() => expect(main().queryByText("Mulch the roses")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row("Plant tomatoes")));
  });

  it("keeps the highlight on a repeating task", async () => {
    stubApi([task({ title: "Water the ferns", listId: garden.id, dueDate: "2026-10-01", recurRule: "FREQ=WEEKLY", recurFrom: "due" })]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water the ferns");
    await userEvent.keyboard("jx");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Next due"));
    expect(document.activeElement).toBe(row("Water the ferns"));
  });

  it("opens with o from a row's title button", async () => {
    const { tasks } = threeTasks();
    await main().findByText("Weed the beds");
    main().getByRole("button", { name: "Plant tomatoes" }).focus();
    await userEvent.keyboard("o");
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveProperty("value", "Plant tomatoes");
    expect(tasks).toHaveLength(3);
  });

  it("leaves the arrow keys to the panel's own controls", async () => {
    const tasks = [
      task({ title: "Water the ferns", listId: garden.id, dueDate: "2026-10-01", recurRule: "FREQ=WEEKLY", recurFrom: "due" }),
      task({ title: "Plant tomatoes", listId: garden.id }),
    ];
    stubApi(tasks);
    const { href } = renderAt(`/list/${garden.id}?task=${tasks[0]!.id}`);
    const radio = await screen.findByRole("radio", { name: "From due date" });
    radio.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(href()).toBe(`/list/${garden.id}?task=${tasks[0]!.id}`);
  });

  it("starts again on another screen", async () => {
    stubApi([task({ title: "Weed the beds", listId: inbox.id, labels: ["next"] }), task({ title: "Plant tomatoes", listId: inbox.id, labels: ["next"] })]);
    renderAt("/next");
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
    await userEvent.keyboard("gi");
    await main().findByRole("heading", { name: "Inbox" });
    await userEvent.keyboard("gn");
    await main().findByRole("heading", { name: "Next" });
    await main().findByText("Weed the beds");
    expect(row("Plant tomatoes").classList).not.toContain("highlighted");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Weed the beds"));
  });
});
