import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { List } from "@claudia/shared";
import { errands, garden, inbox, main, projects, renderAt, stubApi, task } from "./testApi";

const shed: List = { ...garden, id: "01JA0000000000000000000009", name: "Shed", position: "a9" };
const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));

/** ⌥J or ⌥K as a Mac sends them: the key is a symbol, the code is the letter. */
const step = (letter: "j" | "k") =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: letter === "j" ? "∆" : "˚", code: `Key${letter.toUpperCase()}`, altKey: true });

function setUp(path: string) {
  stubApi([
    task({ title: "Sort the post", listId: inbox.id }),
    task({ title: "Buy nails", listId: errands.id }),
    task({ title: "Write the report", listId: projects.id }),
    task({ title: "Weed the beds", listId: garden.id }),
    task({ title: "Oil the hinges", listId: shed.id }),
  ], { lists: [inbox, errands, projects, garden, shed] });
  return renderAt(path);
}

beforeEach(() => localStorage.removeItem("claudia.context"));

describe("stepping through the sidebar's lists", () => {
  it("goes to the next and previous list with ⌥J and ⌥K, skipping folders and wrapping at the ends", async () => {
    const { href } = setUp("/inbox");
    await main().findByText("Sort the post");
    const path = async (expected: string, title: string) => {
      await waitFor(() => expect(href()).toBe(expected));
      await main().findByText(title);
    };
    step("j");
    await path(`/list/${errands.id}`, "Buy nails");
    step("j");
    await path(`/list/${projects.id}`, "Write the report");
    step("j");
    await path(`/list/${garden.id}`, "Weed the beds");
    step("j");
    await path(`/list/${shed.id}`, "Oil the hinges");
    step("j");
    await path("/inbox", "Sort the post");
    step("k");
    await path(`/list/${shed.id}`, "Oil the hinges");
    expect(sidebar().getByRole("link", { name: /^Shed/ }).getAttribute("aria-current")).toBe("page");
  });

  it("keeps the keyboard on the tasks, highlighting the new list's first row", async () => {
    setUp(`/list/${errands.id}`);
    await main().findByText("Buy nails");
    step("j");
    await waitFor(() => expect(document.activeElement).toBe(main().getByText("Write the report").closest("li")));
    await userEvent.keyboard("x");
    await waitFor(() => expect(main().queryByText("Write the report")).toBeNull());
  });

  it("starts from the first list on a view, and the last going back", async () => {
    const { href } = setUp("/today");
    await screen.findByRole("link", { name: /^Shed/ });
    step("k");
    await waitFor(() => expect(href()).toBe(`/list/${shed.id}`));
  });

  it("follows the context", async () => {
    const { href } = setUp(`/list/${errands.id}`);
    await main().findByText("Buy nails");
    await userEvent.keyboard("3"); // Personal: Acme's Projects is hidden.
    step("j");
    await waitFor(() => expect(href()).toBe(`/list/${garden.id}`));
    expect(sidebar().queryByRole("link", { name: /^Projects/ })).toBeNull();
  });

  it("skips the lists in a collapsed folder", async () => {
    const { href } = setUp(`/list/${errands.id}`);
    await main().findByText("Buy nails");
    const acme = sidebar().getByText("Acme").closest("details")!;
    acme.open = false;
    step("j");
    await waitFor(() => expect(href()).toBe(`/list/${garden.id}`));
  });
});
