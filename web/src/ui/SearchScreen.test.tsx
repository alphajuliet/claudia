import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, inbox, main, renderAt, stubApi, task } from "./testApi";

const sectionTitles = () => main().getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Search screen", () => {
  it("searches with labels and words, grouped by list", async () => {
    stubApi([
      task({ title: "Water the beans", listId: garden.id, labels: ["next"] }),
      task({ title: "Water bill", listId: inbox.id }),
      task({ title: "Prune", listId: garden.id, labels: ["next"] }),
    ]);
    renderAt("/search?q=%23next%20water");
    expect(await main().findByText("Water the beans")).toBeTruthy();
    expect(main().queryByText("Water bill")).toBeNull();
    expect(main().queryByText("Prune")).toBeNull();
  });

  it("shows a problem under the field and keeps the last results", async () => {
    stubApi([task({ title: "Water the beans", listId: garden.id })]);
    renderAt("/search");
    const field = await main().findByRole("searchbox", { name: "Search" });
    await userEvent.type(field, "water");
    expect(await main().findByText("Water the beans")).toBeTruthy();
    await userEvent.type(field, " colour:red");
    expect((await main().findByRole("alert")).textContent).toBe('There\'s no field "colour" (column 7)');
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(main().getByText("Water the beans")).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, "water");
    await waitFor(() => expect(main().queryByRole("alert")).toBeNull());
  });

  it("puts the menus' sort and grouping in the address, and shows the typed ones", async () => {
    stubApi([
      task({ title: "Beans", listId: garden.id, labels: ["wip"] }),
      task({ title: "Bill", listId: inbox.id, labels: ["next"] }),
    ]);
    const { href } = renderAt("/search?q=b%20group:label:next,wip");
    await main().findByText("Beans");
    const group = main().getByRole("combobox", { name: "Group" }) as HTMLSelectElement;
    await waitFor(() => expect(group.value).toBe("label:next,wip"));
    expect(sectionTitles()).toEqual(["next", "wip"]);
    // Grouped by label, each row says its list.
    expect(within(main().getByText("Beans").closest("li")!).getByText("Garden")).toBeTruthy();

    await userEvent.selectOptions(main().getByRole("combobox", { name: "Sort" }), "title-desc");
    await waitFor(() => expect(href()).toContain("sort=title-desc"));
    await userEvent.selectOptions(group, "none");
    await waitFor(() => expect(href()).toContain("group=none"));
    await waitFor(() => expect(main().queryAllByRole("heading", { level: 2 })).toHaveLength(0));
    const rows = main().getAllByRole("listitem").map((li) => li.textContent);
    expect(rows.findIndex((r) => r?.includes("Bill"))).toBeLessThan(rows.findIndex((r) => r?.includes("Beans")));
  });

  it("opens and closes the cheat sheet", async () => {
    stubApi([]);
    renderAt("/search");
    const help = await main().findByRole("button", { name: "Search help" });
    expect(screen.queryByRole("region", { name: "Search help" })).toBeNull();
    await userEvent.click(help);
    expect(screen.getByRole("region", { name: "Search help" }).textContent).toContain("is:available");
    await userEvent.click(help);
    expect(screen.queryByRole("region", { name: "Search help" })).toBeNull();
  });
});
