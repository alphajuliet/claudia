import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { resetCollapsed } from "./collapsed";
import { garden, main, renderAt, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;

/** Plan (with Dig and Sow under it), then a heading Later with Prune under it. */
function outline(given?: ReturnType<typeof task>[]) {
  const plan = task({ title: "Plan", listId: garden.id });
  const tasks = given ?? [
    plan,
    task({ title: "Dig", listId: garden.id, parentId: plan.id }),
    task({ title: "Sow", listId: garden.id, parentId: plan.id }),
    task({ title: "Later", listId: garden.id, kind: "heading" }),
    task({ title: "Prune", listId: garden.id }),
  ];
  stubApi(tasks);
  return { tasks, ...renderAt(`/list/${garden.id}`) };
}

describe("collapsing", () => {
  it("collapses and expands a task's subtasks from its toggle, remembered after a reload", async () => {
    const { unmount, tasks } = outline();
    await main().findByText("Dig");
    expect(main().queryByRole("button", { name: "Collapse Dig" })).toBeNull();
    await userEvent.click(main().getByRole("button", { name: "Collapse Plan" }));
    expect(main().queryByText("Dig")).toBeNull();
    expect(main().queryByText("Sow")).toBeNull();
    expect(main().getByRole("button", { name: "Expand Plan" }).getAttribute("aria-expanded")).toBe("false");
    // The toggle doesn't open the panel.
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();

    unmount();
    resetCollapsed();
    outline(tasks);
    await main().findByText("Plan");
    expect(main().queryByText("Dig")).toBeNull();
    await userEvent.click(main().getByRole("button", { name: "Expand Plan" }));
    expect(main().getByText("Dig")).toBeTruthy();
  });

  it("collapses a heading's section", async () => {
    outline();
    await main().findByText("Prune");
    await userEvent.click(main().getByRole("button", { name: "Collapse Later" }));
    expect(main().queryByText("Prune")).toBeNull();
    expect(main().getByRole("button", { name: "Later" })).toBeTruthy();
  });

  it("collapses with h, goes to the parent with h again, and expands with l", async () => {
    outline();
    await main().findByText("Dig");
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(row("Dig"));
    // Dig has nothing under it: h goes to Plan.
    await userEvent.keyboard("h");
    expect(document.activeElement).toBe(row("Plan"));
    await userEvent.keyboard("h");
    expect(main().queryByText("Dig")).toBeNull();
    // j skips the hidden rows.
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(main().getByRole("button", { name: "Later" }));
    await userEvent.keyboard("k");
    await userEvent.keyboard("l");
    expect(main().getByText("Dig")).toBeTruthy();
    expect(document.activeElement).toBe(row("Plan"));
  });

  it("goes from a task under a heading to the heading with h", async () => {
    outline();
    await main().findByText("Prune");
    await userEvent.keyboard("k");
    expect(document.activeElement).toBe(row("Prune"));
    await userEvent.keyboard("h");
    expect(document.activeElement).toBe(main().getByRole("button", { name: "Later" }));
    await userEvent.keyboard("h");
    expect(main().queryByText("Prune")).toBeNull();
  });

  it("hands the highlight to the item collapsed over it", async () => {
    outline();
    await main().findByText("Sow");
    await userEvent.keyboard("jjj");
    expect(document.activeElement).toBe(row("Sow"));
    await userEvent.click(main().getByRole("button", { name: "Collapse Plan" }));
    expect(row("Plan").classList).toContain("highlighted");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(main().getByRole("button", { name: "Later" }));
  });
});
