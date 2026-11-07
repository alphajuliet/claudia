import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, renderAt, stubApi, task } from "./testApi";

const panel = () => screen.findByRole("complementary", { name: "Task details" });

describe("tapping a task on a touch screen", () => {
  it("opens the task rather than renaming it", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    stubApi([weed]);
    const { href } = renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch" });
    fireEvent.click(title);
    expect(href()).toBe(`/list/${garden.id}?task=${weed.id}`);
    expect(await within(await panel()).findByDisplayValue("Weed the beds")).toBeTruthy();
    expect(within(main().getByText("Weed the beds").closest("li")!).queryByRole("textbox")).toBeNull();
  });

  it("doesn't rename on a double tap", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "touch" });
    fireEvent.dblClick(title);
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
  });

  it("renames inline on a mouse double click", async () => {
    stubApi([task({ title: "Weed the beds", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByText("Weed the beds");
    fireEvent.pointerDown(title, { pointerType: "mouse" });
    fireEvent.dblClick(title);
    expect(main().getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Weed the beds");
  });

  it("closes the panel with Done", async () => {
    const weed = task({ title: "Weed the beds", listId: garden.id });
    stubApi([weed]);
    const { href } = renderAt(`/list/${garden.id}?task=${weed.id}`);
    await userEvent.click(within(await panel()).getByRole("button", { name: "Done" }));
    expect(href()).toBe(`/list/${garden.id}`);
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });
});
