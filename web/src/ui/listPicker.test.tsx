import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { errands, garden, main, projects, renderAt, stubApi, task } from "./testApi";

const dialog = () => screen.queryByRole("dialog", { name: "Go to a list" });
const options = () => within(dialog() as HTMLElement).queryAllByRole("option").map((o) => o.querySelector(".list-picker-name")?.textContent);
const active = () => dialog()?.querySelector('[aria-selected="true"] .list-picker-name')?.textContent;

async function open(path = "/next") {
  stubApi([]);
  const view = renderAt(path);
  await main().findByRole("heading", { name: "Next" });
  await screen.findByRole("link", { name: /^Garden/ });
  await userEvent.keyboard("gl");
  return view;
}

describe("going to a list with g l", () => {
  beforeEach(() => localStorage.removeItem("claudia.context"));

  it("opens with the field focused and every list, the Inbox first", async () => {
    await open();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "List name" }));
    expect(options()).toEqual(["Inbox", "Errands", "Projects", "Garden"]);
    expect(within(dialog() as HTMLElement).getByText("Life")).toBeTruthy();
  });

  it("narrows as you type, and Enter goes to the best match", async () => {
    const { href } = await open();
    await userEvent.keyboard("gar");
    expect(options()).toEqual(["Garden"]);
    await userEvent.keyboard("{Enter}");
    expect(dialog()).toBeNull();
    expect(href()).toBe(`/list/${garden.id}`);
  });

  it("chooses with the arrows, wrapping, and goes back to the top as you type", async () => {
    await open();
    expect(active()).toBe("Inbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe("Projects");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(active()).toBe("Garden");
    await userEvent.keyboard("e");
    expect(active()).toBe(options()[0]);
  });

  it("goes to the Inbox's view", async () => {
    const { href } = await open();
    await userEvent.keyboard("{Enter}");
    expect(href()).toBe("/inbox");
  });

  it("goes to a list clicked", async () => {
    const { href } = await open();
    await userEvent.click(within(dialog() as HTMLElement).getByText("Errands"));
    expect(href()).toBe(`/list/${errands.id}`);
  });

  it("says when nothing matches, and Enter does nothing", async () => {
    const { href } = await open();
    await userEvent.keyboard("zzz{Enter}");
    expect(within(dialog() as HTMLElement).getByText("No matching lists.")).toBeTruthy();
    expect(href()).toBe("/next");
  });

  it("closes on Escape and gives focus back, without closing anything else", async () => {
    stubApi([task({ title: "Water the beans", listId: garden.id, labels: ["next"] })]);
    const { href } = renderAt("/next");
    await main().findByText("Water the beans");
    await screen.findByRole("link", { name: /^Garden/ });
    await userEvent.keyboard("j{Enter}");
    await waitFor(() => expect(href()).toContain("?task="));
    const row = main().getByText("Water the beans").closest("li")!;
    row.focus();
    await userEvent.keyboard("gl");
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(href()).toContain("?task=");
    expect(document.activeElement).toBe(row);
  });

  it("keeps list keys from running behind it", async () => {
    const { href } = await open();
    await userEvent.keyboard("gt");
    expect(href()).toBe("/next");
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("gt");
  });

  it("finds lists outside the context, and leaves the context alone", async () => {
    localStorage.setItem("claudia.context", "personal");
    const { href } = await open();
    expect(options()).toContain("Projects");
    await userEvent.keyboard("proj{Enter}");
    expect(href()).toBe(`/list/${projects.id}`);
    expect(screen.getByRole("group", { name: "Context" }).querySelector('[aria-pressed="true"]')?.textContent).toBe("Personal");
  });
});
