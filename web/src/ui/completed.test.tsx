import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { resetShowCompleted } from "./showCompleted";
import { at, garden, main, renderAt, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;
const posts = (fetchMock: ReturnType<typeof stubApi>, suffix: string) =>
  fetchMock.mock.calls.filter(([p, init]) => String(p).endsWith(suffix) && init?.method === "POST").map(([p]) => p);

function garden3() {
  // Positions given, as generated ones (a9, a10) don't sort in creation order.
  const plan = task({ title: "Plan", listId: garden.id, completedAt: at, position: "b1" });
  const tasks = [
    task({ title: "Weed the beds", listId: garden.id, position: "b0" }),
    plan,
    task({ title: "Dig", listId: garden.id, parentId: plan.id, completedAt: at }),
  ];
  const fetchMock = stubApi(tasks);
  return { tasks, fetchMock, ...renderAt(`/list/${garden.id}`) };
}

describe("show completed", () => {
  it("shows completed tasks and subtasks in place, ticked, and remembers the choice", async () => {
    const { fetchMock, unmount, tasks } = garden3();
    await main().findByText("Weed the beds");
    expect(main().queryByText("Plan")).toBeNull();
    await userEvent.click(main().getByRole("button", { name: "Show completed" }));
    expect(await main().findByText("Plan")).toBeTruthy();
    expect(row("Plan").classList).toContain("completed");
    expect((main().getByRole("checkbox", { name: "Reopen Plan" }) as HTMLInputElement).checked).toBe(true);
    expect(row("Dig").getAttribute("data-depth")).toBe("1");
    expect(fetchMock.mock.calls.some(([p]) => String(p).includes("status=all"))).toBe(true);
    expect(main().getByRole("button", { name: "Hide completed" }).getAttribute("aria-pressed")).toBe("true");

    unmount();
    resetShowCompleted();
    stubApi(tasks);
    renderAt(`/list/${garden.id}`);
    expect(await main().findByText("Plan")).toBeTruthy();
  });

  it("toggles with Shift+C", async () => {
    garden3();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("{Shift>}C{/Shift}");
    expect(await main().findByText("Plan")).toBeTruthy();
    await userEvent.keyboard("{Shift>}C{/Shift}");
    await waitFor(() => expect(main().queryByText("Plan")).toBeNull());
  });

  it("reopens a completed task and the subtasks completed with it by unticking it", async () => {
    const { fetchMock, tasks } = garden3();
    await userEvent.click(await main().findByRole("button", { name: "Show completed" }));
    await userEvent.click(await main().findByRole("checkbox", { name: "Reopen Plan" }));
    expect(posts(fetchMock, "/uncomplete")).toEqual([`/api/tasks/${tasks[1]!.id}/uncomplete`]);
    await waitFor(() => expect(row("Plan").classList).not.toContain("completed"));
    expect(row("Dig").classList).not.toContain("completed");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Reopened “Plan”"));
  });

  it("keeps a task in place, ticked, when it is completed with x", async () => {
    const { fetchMock, tasks } = garden3();
    await userEvent.click(await main().findByRole("button", { name: "Show completed" }));
    await main().findByText("Plan");
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(row("Weed the beds"));
    await userEvent.keyboard("x");
    expect(posts(fetchMock, "/complete")).toEqual([`/api/tasks/${tasks[0]!.id}/complete`]);
    await waitFor(() => expect(row("Weed the beds").classList).toContain("completed"));
    expect(document.activeElement).toBe(row("Weed the beds"));
    // x again reopens it.
    await userEvent.keyboard("x");
    await waitFor(() => expect(row("Weed the beds").classList).not.toContain("completed"));
  });

  it("keeps the rows and the highlight while the list reloads with completed tasks", async () => {
    garden3();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("j");
    await userEvent.keyboard("{Shift>}C{/Shift}");
    expect(main().queryByText("Loading…")).toBeNull();
    expect(await main().findByText("Plan")).toBeTruthy();
    expect(row("Weed the beds").classList).toContain("highlighted");
  });

  it("reads C typed with Caps Lock as c (add a task)", async () => {
    garden3();
    await main().findByText("Weed the beds");
    await userEvent.keyboard("C");
    expect(document.activeElement).toBe(main().getByRole("textbox", { name: "Add a task" }));
    expect(main().queryByText("Plan")).toBeNull();
  });
});
