import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Task } from "@claudia/shared";
import { garden, main, renderAt, sentBodies, stubApi, task, type StubOptions } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
/** The task titles on screen, in order. */
const titles = () => main().getAllByRole("listitem").map((li) => li.querySelector(".task-title")?.textContent);
/** The headings on screen, in order. */
const headings = () => main().getAllByRole("region").map((r) => r.querySelector(".section-title-button")?.textContent);
const section = (name: string) => within(main().getByRole("region", { name }));
const moves = (fetchMock: ReturnType<typeof stubApi>, t: Task) => sentBodies(fetchMock, "POST", `/api/tasks/${t.id}/move`);
const altUp = () => userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
const altDown = () => userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

function threeTasks(opts: StubOptions = {}) {
  const tasks = [
    task({ title: "Weed the beds", listId: garden.id }),
    task({ title: "Plant tomatoes", listId: garden.id }),
    task({ title: "Mulch the roses", listId: garden.id }),
  ];
  const fetchMock = stubApi(tasks, opts);
  renderAt(`/list/${garden.id}`);
  return { tasks, fetchMock };
}

describe("Alt+↑ and Alt+↓", () => {
  it("moves the highlighted task past its neighbour and keeps it highlighted and focused", async () => {
    const { tasks: [a, b], fetchMock } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
    await altUp();
    await waitFor(() => expect(titles()).toEqual(["Plant tomatoes", "Weed the beds", "Mulch the roses"]));
    expect(moves(fetchMock, b!)).toEqual([{ parentId: null, beforeId: a!.id }]);
    await waitFor(() => expect(document.activeElement).toBe(row("Plant tomatoes")));
    expect(row("Plant tomatoes").classList).toContain("highlighted");

    // The server agrees: the order holds after the refetch, and the task moves on down.
    await altDown();
    await altDown();
    await waitFor(() => expect(titles()).toEqual(["Weed the beds", "Mulch the roses", "Plant tomatoes"]));
    await waitFor(() => expect(document.activeElement).toBe(row("Plant tomatoes")));
  });

  it("sends quick moves to the server one at a time, in order", async () => {
    let release = () => {};
    const first = new Promise<void>((resolve) => { release = resolve; });
    let gated = false;
    const { tasks: [a, , c], fetchMock } = threeTasks({ gate: (method) => (method === "POST" && !gated ? ((gated = true), first) : undefined) });
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j");
    await altDown();
    await altDown();
    await waitFor(() => expect(titles()).toEqual(["Plant tomatoes", "Mulch the roses", "Weed the beds"]));
    // The second waits until the first has been answered.
    expect(moves(fetchMock, a!)).toEqual([{ parentId: null, beforeId: c!.id }]);
    release();
    await waitFor(() => expect(moves(fetchMock, a!)).toEqual([{ parentId: null, beforeId: c!.id }, { parentId: null }]));
    await waitFor(() => expect(titles()).toEqual(["Plant tomatoes", "Mulch the roses", "Weed the beds"]));
  });

  it("does nothing on the last task going down", async () => {
    const { tasks: [, , c], fetchMock } = threeTasks();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("k");
    expect(document.activeElement).toBe(row("Mulch the roses"));
    await altDown();
    expect(moves(fetchMock, c!)).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
  });

  it("moves a task first under a heading up into the section above", async () => {
    const tasks = [
      task({ title: "Weed the beds", listId: garden.id }),
      task({ title: "Spring", kind: "heading", listId: garden.id }),
      task({ title: "Plant tomatoes", listId: garden.id }),
      task({ title: "Mulch the roses", listId: garden.id }),
    ];
    const [, h, x] = tasks;
    const fetchMock = stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Plant tomatoes");
    await userEvent.keyboard("jjj");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
    await altUp();
    await waitFor(() => expect(section("Spring").queryByText("Plant tomatoes")).toBeNull());
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
    expect(section("Spring").getByText("Mulch the roses")).toBeTruthy();
    expect(moves(fetchMock, x!)).toEqual([{ parentId: null, beforeId: h!.id }]);
    await waitFor(() => expect(document.activeElement).toBe(row("Plant tomatoes")));

    // And back down, first under the heading again.
    await altDown();
    await waitFor(() => expect(section("Spring").getByText("Plant tomatoes")).toBeTruthy());
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]);
    expect(moves(fetchMock, x!).at(-1)).toEqual({ parentId: null, afterId: h!.id });
  });

  it("moves a heading with its section past the next section", async () => {
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
    await userEvent.keyboard("jj");
    expect(document.activeElement?.textContent).toBe("Spring");
    await altDown();
    await waitFor(() => expect(headings()).toEqual(["Summer", "Spring"]));
    expect(section("Spring").getByText("Plant tomatoes")).toBeTruthy();
    expect(section("Summer").getByText("Mulch the roses")).toBeTruthy();
    expect(titles()).toEqual(["Weed the beds", "Mulch the roses", "Plant tomatoes"]);
    expect(moves(fetchMock, spring!)).toEqual([{ parentId: null, withSection: true }]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Spring"));
  });

  it("puts the order back and shows the error when the move fails", async () => {
    let fail = () => {};
    const held = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error("no")); });
    threeTasks({ gate: (method) => (method === "POST" ? held : undefined) });
    await main().findByText("Weed the beds");
    await userEvent.keyboard("jj");
    await altUp();
    await waitFor(() => expect(titles()).toEqual(["Plant tomatoes", "Weed the beds", "Mulch the roses"]));
    fail();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    await waitFor(() => expect(titles()).toEqual(["Weed the beds", "Plant tomatoes", "Mulch the roses"]));
  });

  it("does nothing on a view", async () => {
    const tasks = [
      task({ title: "Weed the beds", listId: garden.id, labels: ["next"] }),
      task({ title: "Plant tomatoes", listId: garden.id, labels: ["next"] }),
    ];
    const fetchMock = stubApi(tasks);
    renderAt("/next");
    await main().findByText("Plant tomatoes");
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(row("Plant tomatoes"));
    await altUp();
    expect(moves(fetchMock, tasks[1]!)).toEqual([]);
    expect(titles()).toEqual(["Weed the beds", "Plant tomatoes"]);
  });
});
