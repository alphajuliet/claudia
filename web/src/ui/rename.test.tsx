import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, personal, renderAt, sentBodies, stubApi } from "./testApi";

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));

describe("renaming lists and folders", () => {
  it("renames a list from its title on the list screen", async () => {
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Garden" }));
    const field = main().getByRole("textbox", { name: "List name" }) as HTMLInputElement;
    expect(field.value).toBe("Garden");
    await userEvent.clear(field);
    await userEvent.type(field, "Veggie patch{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/lists/${garden.id}`)).toEqual([{ name: "Veggie patch" }]);
    expect(main().getByRole("heading", { level: 1, name: "Veggie patch" })).toBeTruthy();
    await waitFor(() => expect(sidebar().getByRole("link", { name: /^Veggie patch/ })).toBeTruthy());
  });

  it("cancels with Escape and ignores an empty or unchanged name", async () => {
    const fetchMock = stubApi([]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Garden" }));
    await userEvent.type(main().getByRole("textbox", { name: "List name" }), "x{Escape}");
    expect(main().getByRole("heading", { level: 1, name: "Garden" })).toBeTruthy();
    await userEvent.click(main().getByRole("button", { name: "Garden" }));
    await userEvent.clear(main().getByRole("textbox", { name: "List name" }));
    await userEvent.keyboard("{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/lists/${garden.id}`)).toEqual([]);
  });

  it("puts the old name back and says why when the rename fails", async () => {
    stubApi([], { failRename: true });
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Garden" }));
    const field = main().getByRole("textbox", { name: "List name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Veggie patch{Enter}");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Boom"));
    expect(main().getByRole("heading", { level: 1, name: "Garden" })).toBeTruthy();
  });

  it("renames a list and a folder in the sidebar on double-click", async () => {
    const fetchMock = stubApi([]);
    renderAt("/inbox");
    await userEvent.dblClick(await sidebar().findByRole("link", { name: /^Garden/ }));
    const list = sidebar().getByRole("textbox", { name: "List name" });
    await userEvent.clear(list);
    await userEvent.type(list, "Veggie patch{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/lists/${garden.id}`)).toEqual([{ name: "Veggie patch" }]);

    await userEvent.dblClick(sidebar().getByText("Life"));
    const folder = sidebar().getByRole("textbox", { name: "Folder name" });
    await userEvent.clear(folder);
    // Space goes into the name, rather than closing the folder.
    await userEvent.type(folder, "Home life{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/folders/${personal.id}`)).toEqual([{ name: "Home life" }]);
    expect(sidebar().getByText("Home life")).toBeTruthy();
    expect(sidebar().getByRole("link", { name: /^Veggie patch/ })).toBeTruthy();
  });
});
