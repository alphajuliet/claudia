import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, renderAt, stubApi, task } from "./testApi";

describe("⌘F and Ctrl+F", () => {
  it("go to Search from a list, even from a text field, and keep the browser's find away", async () => {
    stubApi([task({ title: "Water", listId: garden.id })]);
    const { href } = renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.keyboard("{Meta>}f{/Meta}");
    expect(href()).toBe("/search");
    await screen.findByRole("searchbox");
  });

  it("goes from a text field too, and back to the search field when already there", async () => {
    stubApi([task({ title: "Water", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.click(screen.getByRole("textbox", { name: /add/i }));
    await userEvent.keyboard("{Control>}f{/Control}");
    const field = await screen.findByRole("searchbox");
    await userEvent.tab();
    expect(document.activeElement).not.toBe(field);
    await userEvent.keyboard("{Control>}f{/Control}");
    expect(document.activeElement).toBe(field);
  });
});
