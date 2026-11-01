import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { addDays, garden, inbox, json, main, projects, renderAt, stubApi, task, today } from "./testApi";

const section = (name: string) => within(main().getByRole("region", { name }));
const titles = (name: string) => section(name).queryAllByRole("button", { name: /^[A-Z].*/ }).filter((b) => b.classList.contains("task-title")).map((b) => b.textContent);

async function open(tasks: ReturnType<typeof task>[]) {
  const fetchMock = stubApi(tasks, { lists: [inbox, garden, projects] });
  const view = renderAt("/dashboard");
  await main().findAllByText(/^Nothing|Weed|Dig/);
  await waitFor(() => expect(main().queryByText("Loading…")).toBeNull());
  return { fetchMock, ...view };
}

describe("the dashboard", () => {
  it("shows the date, and each section's tasks with their list", async () => {
    await open([
      task({ title: "Draft plan", listId: projects.id, labels: ["wip"] }),
      task({ title: "Weed", listId: garden.id, dueDate: today }),
      task({ title: "Dig", listId: garden.id, dueDate: addDays(today, 3) }),
      task({ title: "Sam's reply", listId: projects.id, labels: ["waitingOn"], createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString() }),
      task({ title: "Far off", listId: garden.id, dueDate: addDays(today, 8) }),
    ]);
    expect(main().getByRole("heading", { level: 1 }).textContent).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    expect(titles("WIP")).toEqual(["Draft plan"]);
    expect(titles("Overdue and today")).toEqual(["Weed"]);
    expect(titles("This week")).toEqual(["Dig"]);
    expect(titles("Waiting")).toEqual(["Sam's reply"]);
    expect(section("WIP").getByText("Projects")).toBeTruthy();
    expect(section("Waiting").getByText("12d · Projects")).toBeTruthy();
    expect(main().queryByText("Far off")).toBeNull();
  });

  it("shows a task in the first section it fits, but counts it for its view", async () => {
    await open([task({ title: "Weed", listId: garden.id, labels: ["wip"], dueDate: today })]);
    expect(titles("WIP")).toEqual(["Weed"]);
    expect(section("Overdue and today").getByText("Nothing overdue")).toBeTruthy();
    expect(main().getByRole("link", { name: "1 WIP" }).getAttribute("href")).toBe("/wip");
    expect(main().getByRole("link", { name: "1 Today" }).getAttribute("href")).toBe("/today");
  });

  it("marks WIP over the limit, and shows all of it", async () => {
    await open([1, 2, 3, 4].map((n) => task({ title: `Weed ${n}`, listId: garden.id, labels: ["wip"] })));
    expect(titles("WIP")).toHaveLength(4);
    expect(section("WIP").getByText("4/3").classList.contains("wip-over")).toBe(true);
  });

  it("caps long sections, with a link to the view", async () => {
    await open([1, 2, 3, 4, 5, 6, 7].map((n) => task({ title: `Weed ${n}`, listId: garden.id, dueDate: today })));
    expect(titles("Overdue and today")).toHaveLength(5);
    expect(section("Overdue and today").getByRole("link", { name: "2 more" }).getAttribute("href")).toBe("/today");
  });

  it("expands This week in place", async () => {
    await open([1, 2, 3, 4, 5, 6].map((n) => task({ title: `Dig ${n}`, listId: garden.id, dueDate: addDays(today, 2) })));
    expect(titles("This week")).toHaveLength(5);
    await userEvent.click(section("This week").getByRole("button", { name: "1 more" }));
    expect(titles("This week")).toHaveLength(6);
    expect(section("This week").queryByRole("button", { name: "1 more" })).toBeNull();
  });

  it("follows the context", async () => {
    await open([
      task({ title: "Weed", listId: garden.id, labels: ["wip"] }),
      task({ title: "Draft", listId: projects.id, labels: ["wip"] }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(titles("WIP")).toEqual(["Draft"]);
  });

  it("leaves when a task is ticked off", async () => {
    await open([task({ title: "Weed", listId: garden.id, dueDate: today })]);
    await userEvent.click(main().getByRole("checkbox", { name: "Complete Weed" }));
    await waitFor(() => expect(section("Overdue and today").getByText("Nothing overdue")).toBeTruthy());
  });

  it("keeps the other sections when one fails", async () => {
    const fetchMock = stubApi([task({ title: "Weed", listId: garden.id, labels: ["wip"] })], { lists: [inbox, garden, projects] });
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init?: RequestInit) =>
      String(path).includes("label=waitingOn") ? Promise.resolve(json({ error: { code: "boom", message: "Boom" } }, 500)) : real(path, init));
    renderAt("/dashboard");
    expect(await section("Waiting").findByRole("alert")).toBeTruthy();
    expect(await section("WIP").findByText("Weed")).toBeTruthy();
  });

  it("doesn't report a failed section as zero", async () => {
    const fetchMock = stubApi([], { lists: [inbox, garden, projects] });
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init?: RequestInit) =>
      String(path).includes("dueBefore") ? Promise.resolve(json({ error: { code: "boom", message: "Boom" } }, 500)) : real(path, init));
    renderAt("/dashboard");
    await section("Overdue and today").findByRole("alert");
    expect(main().getByRole("link", { name: "– Overdue" })).toBeTruthy();
    expect(main().getByRole("link", { name: "– Today" })).toBeTruthy();
  });

  it("moves a repeating task on at once, before the refetch", async () => {
    let release = () => {};
    const holdRefetch = new Promise<void>((resolve) => { release = resolve; });
    const water = task({ title: "Water pots", listId: garden.id, dueDate: today, recurRule: "FREQ=DAILY", recurFrom: "due" });
    stubApi([water], { lists: [inbox, garden, projects], holdRefetch });
    renderAt("/dashboard");
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Water pots" }));
    await waitFor(() => expect(titles("This week")).toEqual(["Water pots"]));
    release();
  });

  it("is reached with g d", async () => {
    stubApi([]);
    const { href } = renderAt("/inbox");
    await userEvent.keyboard("gd");
    await waitFor(() => expect(href()).toBe("/dashboard"));
  });
});
