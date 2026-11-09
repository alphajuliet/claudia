import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { addDays, errands, garden, inbox, main, renderAt, stubApi, task, today } from "./testApi";

const sectionTitles = () => [...screen.getByRole("main").querySelectorAll(".section-title")].map((h) => h.textContent);
const titles = () => [...main().getAllByRole("listitem")].map((li) => li.querySelector(".task-title")?.textContent);
const note = (title: string) => main().getByText(title).closest("li")!.querySelector(".task-note")?.textContent;
const groupButton = () => screen.getByRole("button", { name: /^Group:/ });

function nextTasks() {
  stubApi([
    task({ title: "Post the parcel", listId: errands.id, labels: ["next"], dueDate: addDays(today, 1) }),
    task({ title: "Water the seedlings", listId: garden.id, labels: ["next"], dueDate: today }),
    task({ title: "Buy compost", listId: garden.id, labels: ["next"] }),
    task({ title: "Pay the fine", listId: errands.id, labels: ["next"], dueDate: addDays(today, -1) }),
  ], { lists: [inbox, errands, garden] });
}

describe("grouping a view", () => {
  it("groups by list until Group switches it to due date, with each row naming its list", async () => {
    nextTasks();
    renderAt("/next");
    await main().findByText("Buy compost");
    expect(groupButton().textContent).toBe("Group: List");
    expect(sectionTitles()).toEqual(["Errands", "Garden"]);
    expect(note("Buy compost")).toBeUndefined();

    await userEvent.click(groupButton());
    expect(groupButton().textContent).toBe("Group: Due date");
    expect(sectionTitles()).toEqual(["Overdue", "Today", "Tomorrow", "No date"]);
    expect(titles()).toEqual(["Pay the fine", "Water the seedlings", "Post the parcel", "Buy compost"]);
    expect(note("Buy compost")).toBe("Garden");
    expect(note("Pay the fine")).toBe("Errands");
  });

  it("remembers the choice per view, and Shift+D switches it back", async () => {
    nextTasks();
    const first = renderAt("/next");
    await main().findByText("Buy compost");
    await userEvent.keyboard("{Shift>}D{/Shift}");
    expect(sectionTitles()).toEqual(["Overdue", "Today", "Tomorrow", "No date"]);
    first.unmount();

    // WIP keeps its own setting.
    const wip = renderAt("/wip");
    await screen.findByRole("heading", { name: "WIP" });
    expect(groupButton().textContent).toBe("Group: List");
    wip.unmount();

    renderAt("/next");
    await main().findByText("Buy compost");
    expect(groupButton().textContent).toBe("Group: Due date");
    await userEvent.keyboard("{Shift>}D{/Shift}");
    expect(sectionTitles()).toEqual(["Errands", "Garden"]);
  });

  it("isn't offered in the Inbox or Someday", async () => {
    stubApi([], { lists: [inbox, garden] });
    const { unmount } = renderAt("/inbox");
    await screen.findByRole("heading", { name: "Inbox" });
    expect(screen.queryByRole("button", { name: /^Group:/ })).toBeNull();
    unmount();
    renderAt("/someday");
    await screen.findByRole("heading", { name: "Someday" });
    expect(screen.queryByRole("button", { name: /^Group:/ })).toBeNull();
  });
});
