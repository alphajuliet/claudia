import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { errands, garden, main, renderAt, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;

function nextView() {
  const tasks = [
    task({ title: "Buy stamps", listId: errands.id, labels: ["next"] }),
    task({ title: "Plant tomatoes", listId: garden.id }),
    task({ title: "Weed the beds", listId: garden.id, labels: ["next"] }),
  ];
  stubApi(tasks);
  return { tasks, ...renderAt("/next") };
}

describe("G: go to the task's list", () => {
  it("opens the highlighted task's list with that task highlighted", async () => {
    const { href } = nextView();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Weed the beds"));
    await userEvent.keyboard("{Shift>}G{/Shift}");
    expect(href()).toBe(`/list/${garden.id}`);
    expect(await main().findByText("Plant tomatoes")).toBeTruthy();
    expect(row("Weed the beds").classList).toContain("highlighted");
    expect(row("Plant tomatoes").classList).not.toContain("highlighted");
    expect(document.activeElement).toBe(row("Weed the beds"));
  });

  it("goes with the panel open, and the task stays open", async () => {
    const { tasks, href } = nextView();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j{Enter}");
    await screen.findByRole("textbox", { name: "Title" });
    row("Weed the beds").focus();
    await userEvent.keyboard("{Shift>}G{/Shift}");
    expect(href()).toBe(`/list/${garden.id}?task=${tasks[2]!.id}`);
    expect(await main().findByText("Plant tomatoes")).toBeTruthy();
    expect(row("Weed the beds").classList).toContain("highlighted");
  });

  it("does nothing on the task's own list", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    await main().findByText("Weed the beds");
    await userEvent.keyboard("{Shift>}G{/Shift}");
    expect(href()).toBe(`/list/${garden.id}`);
  });
});
