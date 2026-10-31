import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, inbox, main, renderAt, stubApi, task } from "./testApi";

describe("keyboard commands", () => {
  it("goes to a view with a g chord", async () => {
    stubApi([]);
    const { href } = renderAt("/inbox");
    await main().findByRole("heading", { name: "Inbox" });
    await userEvent.keyboard("gt");
    expect(href()).toBe("/today");
    expect(await main().findByRole("heading", { name: "Today" })).toBeTruthy();
    await userEvent.keyboard("go");
    expect(href()).toBe("/waiting");
  });

  it("leaves keys typed in a field alone", async () => {
    stubApi([]);
    const { href } = renderAt("/inbox");
    const field = (await main().findByRole("textbox", { name: "Add a task" })) as HTMLInputElement;
    await userEvent.type(field, "gtj/?");
    expect(field.value).toBe("gtj/?");
    expect(href()).toBe("/inbox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves keys with ⌘ or Ctrl to the browser", async () => {
    stubApi([]);
    const { href } = renderAt("/inbox");
    await main().findByRole("heading", { name: "Inbox" });
    await userEvent.keyboard("{Meta>}g{/Meta}t");
    expect(href()).toBe("/inbox");
  });

  it("searches titles and notes from /", async () => {
    stubApi([
      task({ title: "Order mulch", listId: garden.id, notes: "Ask about the compost" }),
      task({ title: "Compost bin", listId: inbox.id }),
      task({ title: "Call the bank", listId: inbox.id }),
    ]);
    const { href } = renderAt("/inbox");
    await main().findByText("Compost bin");
    await userEvent.keyboard("/");
    const field = await main().findByRole("searchbox", { name: "Search" });
    expect(document.activeElement).toBe(field);
    expect(main().getByText("Type to search titles and notes.")).toBeTruthy();
    await userEvent.type(field, "compost");
    expect(await main().findByText("Order mulch")).toBeTruthy();
    expect(main().getByText("Compost bin")).toBeTruthy();
    expect(main().queryByText("Call the bank")).toBeNull();
    await waitFor(() => expect(href()).toBe("/search?q=compost"));
  });

  it("starts a search from the address", async () => {
    stubApi([task({ title: "Compost bin", listId: inbox.id }), task({ title: "Call the bank", listId: inbox.id })]);
    renderAt("/search?q=bank");
    expect(await main().findByText("Call the bank")).toBeTruthy();
    expect((main().getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("bank");
    expect(main().queryByText("Compost bin")).toBeNull();
  });

  it("lists the shortcuts on ? and closes them with Escape, giving focus back", async () => {
    stubApi([]);
    renderAt("/inbox");
    const menu = await screen.findByRole("button", { name: "Menu" });
    menu.focus();
    await userEvent.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByRole("rowheader", { name: "Go to Today" })).toBeTruthy();
    expect(dialog.textContent).toContain("g then t");
    // Keys don't reach the app while the overlay is open.
    await userEvent.keyboard("gt");
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it("closes the task panel on Escape", async () => {
    const t = task({ title: "Water the ferns", listId: inbox.id });
    stubApi([t]);
    const { href } = renderAt(`/inbox?task=${t.id}`);
    await screen.findByRole("complementary", { name: "Task details" });
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
    expect(href()).toBe("/inbox");
  });
});
