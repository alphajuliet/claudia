import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Task } from "@claudia/shared";
import { garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const creates = (fetchMock: ReturnType<typeof stubApi>) => sentBodies(fetchMock, "POST", "/api/tasks");
const deletes = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([p]) => String(p));
const titleField = () => screen.findByRole("textbox", { name: "Title" }) as Promise<HTMLInputElement>;
const settle = () => new Promise((r) => setTimeout(r, 20));
const row = (title: string) => main().getByText(title).closest("li")!;

async function list(tasks: Task[]) {
  const fetchMock = stubApi(tasks);
  const view = renderAt(`/list/${garden.id}`);
  await main().findByText(tasks[0]!.title);
  return { fetchMock, ...view };
}
const a = () => task({ title: "Weed the beds", listId: garden.id });
const b = () => task({ title: "Plant tomatoes", listId: garden.id });

describe("n t", () => {
  it("makes a task after the highlighted one and opens it with the title ready to type over", async () => {
    const first = a();
    const { fetchMock, href } = await list([first, b()]);
    await userEvent.keyboard("jnt");
    const field = await titleField();
    expect(creates(fetchMock)).toEqual([{ listId: garden.id, parentId: null, afterId: first.id, title: "New task" }]);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "New task".length]);
    expect(href()).toContain("?task=");
    await userEvent.keyboard("Prune the roses{Enter}");
    await waitFor(() => expect(main().queryByText("Prune the roses")).not.toBeNull());
  });

  it("keeps a task given a title when the panel closes", async () => {
    const { fetchMock } = await list([a()]);
    await userEvent.keyboard("jnt");
    await titleField();
    await userEvent.keyboard("Prune the roses{Escape}");
    await waitFor(() => expect(main().queryByText("Prune the roses")).not.toBeNull());
    await settle();
    expect(deletes(fetchMock)).toEqual([]);
  });

  it("takes an untouched task away again on Escape, and the keyboard carries on", async () => {
    const { fetchMock, href } = await list([a(), b()]);
    await userEvent.keyboard("jnt");
    await titleField();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(main().queryByText("New task")).toBeNull());
    expect(href()).not.toContain("?task=");
    expect(main().getByText("Plant tomatoes")).toBeTruthy();
    await waitFor(() => expect(main().getAllByRole("listitem").some((li) => li.classList.contains("highlighted"))).toBe(true));
  });

  it("takes it away when the panel closes with Done, too", async () => {
    const { fetchMock } = await list([a()]);
    await userEvent.keyboard("jnt");
    await titleField();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
  });

  it("keeps a task with a subtask added", async () => {
    const { fetchMock } = await list([a()]);
    await userEvent.keyboard("jnt");
    await titleField();
    await userEvent.type(screen.getByRole("textbox", { name: "Add a subtask" }), "Sharpen the secateurs{Enter}");
    await waitFor(() => expect(creates(fetchMock)).toHaveLength(2));
    await userEvent.keyboard("{Escape}");
    await settle();
    expect(deletes(fetchMock)).toEqual([]);
  });

  it("goes first in a heading's section, opening it", async () => {
    const heading = task({ title: "Beds", listId: garden.id, kind: "heading" });
    const { fetchMock } = await list([heading, a()]);
    await userEvent.click(main().getByRole("button", { name: "Collapse Beds" }));
    await userEvent.keyboard("jnt");
    await titleField();
    expect(creates(fetchMock)).toEqual([{ listId: garden.id, parentId: null, afterId: heading.id, title: "New task" }]);
    expect(main().getByRole("button", { name: "Collapse Beds" })).toBeTruthy();
  });

  it("goes under the same parent after a subtask", async () => {
    const parent = a();
    const sub = task({ title: "Dig", listId: garden.id, parentId: parent.id });
    const { fetchMock } = await list([parent, sub]);
    await userEvent.keyboard("jjnt");
    await titleField();
    expect(creates(fetchMock)).toEqual([{ listId: garden.id, parentId: parent.id, afterId: sub.id, title: "New task" }]);
  });

  it("works in a view, in the task's own list, and the panel opens though the view doesn't show it", async () => {
    const shown = task({ title: "Water the beans", listId: garden.id, labels: ["next"] });
    const fetchMock = stubApi([shown]);
    renderAt("/next");
    await main().findByText("Water the beans");
    await userEvent.keyboard("jnt");
    expect((await titleField()).value).toBe("New task");
    expect(creates(fetchMock)).toEqual([{ listId: garden.id, parentId: null, afterId: shown.id, title: "New task" }]);
  });

  it("does nothing with nothing selected", async () => {
    const { fetchMock } = await list([a()]);
    await userEvent.keyboard("nt");
    await settle();
    expect(creates(fetchMock)).toEqual([]);
  });
});

describe("n s", () => {
  it("makes a subtask of the highlighted task, opening it if collapsed", async () => {
    const parent = a();
    const sub = task({ title: "Dig", listId: garden.id, parentId: parent.id });
    const { fetchMock } = await list([parent, sub]);
    await userEvent.click(main().getByRole("button", { name: "Collapse Weed the beds" }));
    await userEvent.keyboard("jns");
    await titleField();
    expect(creates(fetchMock)).toEqual([{ listId: garden.id, parentId: parent.id, title: "New task" }]);
    await waitFor(() => expect(main().getByRole("button", { name: "Collapse Weed the beds" })).toBeTruthy());
  });

  it("does nothing on a heading or a completed task", async () => {
    const heading = task({ title: "Beds", listId: garden.id, kind: "heading" });
    const { fetchMock } = await list([heading]);
    await userEvent.keyboard("jns");
    await settle();
    expect(creates(fetchMock)).toEqual([]);
    expect(within(main().getByRole("region", { name: "Beds" })).getByRole("button", { name: /Beds/ })).toBeTruthy();
  });
});

describe("n h", () => {
  const heading = (title: string) => task({ title, listId: garden.id, kind: "heading" });
  const newHeading = { listId: garden.id, parentId: null, kind: "heading", title: "New heading" };

  it("starts a section after the highlighted task, with the title ready to type over", async () => {
    const first = a();
    const { fetchMock } = await list([first, b()]);
    await userEvent.keyboard("jnh");
    const field = await titleField();
    expect(creates(fetchMock)).toEqual([{ ...newHeading, afterId: first.id }]);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "New heading".length]);
  });

  it("goes after the top-level task from a subtask", async () => {
    const parent = a();
    const sub = task({ title: "Dig", listId: garden.id, parentId: parent.id });
    const { fetchMock } = await list([parent, sub]);
    await userEvent.keyboard("jjnh");
    await titleField();
    expect(creates(fetchMock)).toEqual([{ ...newHeading, afterId: parent.id }]);
  });

  it("goes after the whole section on a heading", async () => {
    const beds = heading("Beds");
    const pots = heading("Pots");
    const { fetchMock } = await list([beds, a(), pots]);
    await userEvent.keyboard("jnh");
    await titleField();
    expect(creates(fetchMock)).toEqual([{ ...newHeading, beforeId: pots.id }]);
  });

  it("goes last on the last heading, and with nothing highlighted", async () => {
    const { fetchMock } = await list([a(), heading("Beds")]);
    await userEvent.keyboard("nh");
    await titleField();
    expect(creates(fetchMock)).toEqual([newHeading]);
  });

  it("is what Add heading does, and works in an empty list", async () => {
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Nothing here.");
    await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
    await titleField();
    expect(creates(fetchMock)).toEqual([newHeading]);
  });

  it("takes an untouched heading away again", async () => {
    const { fetchMock } = await list([a()]);
    await userEvent.keyboard("nh");
    await titleField();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
  });

  it("does nothing outside a list", async () => {
    const fetchMock = stubApi([task({ title: "Weed the beds", listId: garden.id, labels: ["next"] })]);
    renderAt("/next");
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jnh");
    await settle();
    expect(creates(fetchMock)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Add heading" })).toBeNull();
  });

  it("starts with an empty title on a touch screen, keeping the saved one if left empty", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === "(pointer: coarse)", addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      await list([a()]);
      await userEvent.click(screen.getByRole("button", { name: "Add heading" }));
      const field = await titleField();
      expect(field.value).toBe("");
      expect(field.placeholder).toBe("New heading");
      await userEvent.type(field, "Beds{Enter}");
      await waitFor(() => expect(main().queryByText("Beds")).not.toBeNull());
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe("a failed save", () => {
  it("shows the error and opens nothing", async () => {
    const fetchMock = stubApi([a()], { failCreate: true });
    const { href } = renderAt(`/list/${garden.id}`);
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jnt");
    await screen.findByText("Boom");
    expect(href()).not.toContain("?task=");
    expect(row("Weed the beds")).toBeTruthy();
    expect(creates(fetchMock)).toHaveLength(1);
  });
});
