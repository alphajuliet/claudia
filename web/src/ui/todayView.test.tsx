import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { addDays, garden, inbox, main, renderAt, stubApi, task, today } from "./testApi";

const titles = () => [...main().getAllByRole("listitem")].map((li) => li.querySelector(".task-title")?.textContent);
const sidebarCount = () => within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: /^Today/ }).querySelector(".nav-count")?.textContent;

describe("the Today view", () => {
  it("shows tasks due or started by today, and counts them", async () => {
    stubApi([
      task({ title: "Due today", listId: garden.id, dueDate: today }),
      task({ title: "Started, due later", listId: garden.id, startDate: addDays(today, -2), dueDate: addDays(today, 20) }),
      task({ title: "Starts today", listId: garden.id, startDate: today }),
      task({ title: "Starts tomorrow", listId: garden.id, startDate: addDays(today, 1) }),
      task({ title: "Due tomorrow", listId: garden.id, dueDate: addDays(today, 1) }),
    ], { lists: [inbox, garden] });
    renderAt("/today");
    await main().findByText("Starts today");
    expect(titles()).toEqual(["Due today", "Started, due later", "Starts today"]);
    await waitFor(() => expect(sidebarCount()).toBe("3"));
  });

  it("leaves out a started task that's snoozed", async () => {
    stubApi([
      task({ title: "Due today", listId: garden.id, dueDate: today }),
      task({ title: "Started, snoozed", listId: garden.id, startDate: today, snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() }),
    ], { lists: [inbox, garden] });
    renderAt("/today");
    await main().findByText("Due today");
    expect(main().queryByText("Started, snoozed")).toBeNull();
  });
});
