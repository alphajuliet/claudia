import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, inbox, main, renderAt, sentBodies, stubApi, task, today } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
const order = () => [...main().getAllByRole("listitem")].map((li) => li.querySelector(".task-title")?.textContent);

const mixed = () => [
  task({ title: "Compost", listId: garden.id, dueDate: today, priority: "low" }),
  task({ title: "Water", listId: garden.id, dueDate: today }),
  task({ title: "Harvest", listId: garden.id, dueDate: today, priority: "high" }),
];

describe("priority", () => {
  it("marks High and Low rows, and says so to screen readers", async () => {
    stubApi(mixed());
    renderAt(`/list/${garden.id}`);
    await main().findByText("Harvest");
    expect(row("Harvest").classList).toContain("priority-high");
    expect(within(row("Harvest")).getByText("High priority")).toBeTruthy();
    expect(row("Compost").classList).toContain("priority-low");
    expect(row("Water").className).not.toMatch(/priority-/);
  });

  it("keeps a list's manual order", async () => {
    stubApi(mixed());
    renderAt(`/list/${garden.id}`);
    await main().findByText("Harvest");
    expect(order()).toEqual(["Compost", "Water", "Harvest"]);
  });

  it("sorts a view by priority", async () => {
    stubApi(mixed(), { lists: [inbox, garden] });
    renderAt("/today");
    await main().findByText("Harvest");
    expect(order()).toEqual(["Harvest", "Water", "Compost"]);
  });

  it("is set from the task panel", async () => {
    const water = task({ title: "Water", listId: garden.id });
    const fetchMock = stubApi([water]);
    renderAt(`/list/${garden.id}?task=${water.id}`);
    const group = within(await screen.findByRole("group", { name: "Priority" }));
    expect(group.getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(group.getByRole("button", { name: "High" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toContainEqual({ priority: "high" }));
    await waitFor(() => expect(row("Water").classList).toContain("priority-high"));
    expect(group.getByRole("button", { name: "High" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("is set with p h and p l", async () => {
    const water = task({ title: "Water", listId: garden.id });
    const fetchMock = stubApi([water]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.keyboard("j");
    await userEvent.keyboard("ph");
    await waitFor(() => expect(row("Water").classList).toContain("priority-high"));
    await userEvent.keyboard("pl");
    await waitFor(() => expect(row("Water").classList).toContain("priority-low"));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ priority: "high" }, { priority: "low" }]);
  });
});
