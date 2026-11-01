import { act, screen, waitFor } from "@testing-library/react";
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

  it("changes context with 1 to 4, and narrows what the view shows", async () => {
    stubApi([task({ title: "Water the beans", listId: garden.id, labels: ["next"] })]);
    localStorage.removeItem("claudia.context");
    renderAt("/next");
    await main().findByText("Water the beans");
    const pressed = () => screen.getByRole("group", { name: "Context" }).querySelector('[aria-pressed="true"]')?.textContent;
    expect(pressed()).toBe("All");
    await userEvent.keyboard("2");
    expect(pressed()).toBe("Work");
    await waitFor(() => expect(main().queryByText("Water the beans")).toBeNull());
    await userEvent.keyboard("3");
    expect(pressed()).toBe("Personal");
    await main().findByText("Water the beans");
    await userEvent.keyboard("4");
    expect(pressed()).toBe("Home");
    await userEvent.keyboard("1");
    expect(pressed()).toBe("All");
  });

  it("shows Alt and Shift as symbols in the shortcuts", async () => {
    stubApi([]);
    renderAt("/inbox");
    await main().findByRole("heading", { name: "Inbox" });
    await userEvent.keyboard("?");
    const row = screen.getByRole("row", { name: /Move list up/ });
    expect(row.querySelector("kbd")?.textContent).toBe("⌥⇧↑");
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

  it("keeps the search on / from the search screen", async () => {
    stubApi([task({ title: "Call the bank", listId: inbox.id })]);
    const { href, location } = renderAt("/search?q=bank");
    const found = await main().findByText("Call the bank");
    const entries = location.history!.length;
    found.closest("li")!.focus();
    await userEvent.keyboard("/");
    const field = main().getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("bank");
    expect(href()).toBe("/search?q=bank");
    expect(location.history!.length).toBe(entries);
  });

  it("takes up a search from the address when it changes", async () => {
    stubApi([task({ title: "Call the bank", listId: inbox.id }), task({ title: "Compost bin", listId: inbox.id })]);
    const { location } = renderAt("/search?q=bank");
    await main().findByText("Call the bank");
    act(() => location.navigate("/search?q=compost"));
    expect(await main().findByText("Compost bin")).toBeTruthy();
    expect((main().getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("compost");
    await new Promise((r) => setTimeout(r, 300));
    expect(location.history!.at(-1)).toBe("/search?q=compost");
  });

  it("closes the drawer when a g chord goes elsewhere", async () => {
    stubApi([]);
    const { container, href } = renderAt("/inbox");
    await main().findByRole("heading", { name: "Inbox" });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(container.querySelector(".shell")!.classList).toContain("drawer-open");
    await userEvent.keyboard("gt");
    expect(href()).toBe("/today");
    expect(container.querySelector(".shell")!.classList).not.toContain("drawer-open");
  });
});
