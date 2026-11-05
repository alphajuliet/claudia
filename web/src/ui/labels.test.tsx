import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const rows = () => within(main().getByRole("list", { name: "Labels" }));
const rowOf = (name: string) => rows().getByRole("button", { name: `${name}, rename` }).closest("li")!;

afterEach(() => vi.restoreAllMocks());

describe("label colours", () => {
  it("shows a label's colour on task rows wherever it appears, and leaves grey ones plain", async () => {
    stubApi([task({ title: "Water", listId: garden.id, labels: ["errand", "next"] })], { labels: [{ name: "errand", color: "teal" }, "next"] });
    renderAt(`/list/${garden.id}`);
    const row = (await main().findByText("Water")).closest("li")!;
    await waitFor(() => expect(within(row).getByText("errand").getAttribute("data-color")).toBe("teal"));
    expect(within(row).getByText("next").hasAttribute("data-color")).toBe(false);
  });

  it("colours the chips in the task panel and the dots in the label picker", async () => {
    const water = task({ title: "Water", listId: garden.id, labels: ["errand"] });
    stubApi([water], { labels: [{ name: "errand", color: "teal" }, { name: "wip", color: "rose" }] });
    renderAt(`/list/${garden.id}?task=${water.id}`);
    const panel = within(await screen.findByRole("complementary"));
    const chip = (await panel.findByRole("button", { name: "Remove label errand" })).closest("li")!;
    await waitFor(() => expect(chip.getAttribute("data-color")).toBe("teal"));
    await userEvent.click(panel.getByRole("combobox", { name: "Add a label" }));
    const option = await screen.findByRole("option", { name: "wip" });
    expect(option.querySelector(".label-dot")!.getAttribute("data-color")).toBe("rose");
  });
});

describe("Labels screen", () => {
  it("lists labels alphabetically, ignoring case, with their open-task counts", async () => {
    stubApi(
      [
        task({ title: "A", listId: garden.id, labels: ["next"] }),
        task({ title: "B", listId: garden.id, labels: ["next", "Tim"] }),
      ],
      { labels: ["next", "Tim", "admin"] },
    );
    renderAt("/labels");
    await screen.findByRole("heading", { name: "Labels" });
    await waitFor(() => expect(rows().getAllByRole("listitem")).toHaveLength(3));
    expect(rows().getAllByRole("listitem").map((li) => li.querySelector(".chip")!.textContent)).toEqual(["admin", "next", "Tim"]);
    await waitFor(() => expect(within(rowOf("next")).getByText("2 open tasks")).toBeTruthy());
    expect(within(rowOf("Tim")).getByText("1 open task")).toBeTruthy();
    expect(within(rowOf("admin")).getByText("No open tasks")).toBeTruthy();
  });

  it("is in the sidebar and on g #", async () => {
    stubApi([]);
    const { href } = renderAt("/dashboard");
    await screen.findByRole("link", { name: "Labels" });
    await userEvent.keyboard("g#");
    expect(href()).toBe("/labels");
  });

  it("adds a label, and reports a name that's taken", async () => {
    const fetchMock = stubApi([], { labels: ["next"] });
    renderAt("/labels");
    const field = await screen.findByRole("textbox", { name: "New label" });
    await userEvent.type(field, "#errand{Enter}");
    await waitFor(() => expect(rowOf("errand")).toBeTruthy());
    expect(sentBodies(fetchMock, "POST", "/api/labels")).toEqual([{ name: "errand" }]);
    expect((field as HTMLInputElement).value).toBe("");

    await userEvent.type(field, "Next{Enter}");
    expect(await screen.findByText("A label named 'Next' already exists")).toBeTruthy();
    expect((field as HTMLInputElement).value).toBe("Next");
  });

  it("sets a colour from the palette and back to Default", async () => {
    const fetchMock = stubApi([], { labels: ["errand"] });
    renderAt("/labels");
    const colour = await screen.findByRole("button", { name: "Colour for errand: Default" });
    await userEvent.click(colour);
    const swatches = within(screen.getByRole("group", { name: "Colours for errand" }));
    expect(swatches.getAllByRole("button")).toHaveLength(17);
    expect(swatches.getByRole("button", { name: "Default" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(swatches.getByRole("button", { name: "Teal" }));
    expect(screen.queryByRole("group", { name: "Colours for errand" })).toBeNull();
    expect(rowOf("errand").querySelector(".chip")!.getAttribute("data-color")).toBe("teal");
    await screen.findByRole("button", { name: "Colour for errand: Teal" });

    await userEvent.click(screen.getByRole("button", { name: "Colour for errand: Teal" }));
    await userEvent.click(screen.getByRole("button", { name: "Default" }));
    await waitFor(() => expect(rowOf("errand").querySelector(".chip")!.hasAttribute("data-color")).toBe(false));
    expect(sentBodies(fetchMock, "PATCH", `/api/labels/01JD${"0".repeat(22)}`)).toEqual([{ color: "teal" }, { color: null }]);
  });

  it("closes the palette with Escape, without a change", async () => {
    const fetchMock = stubApi([], { labels: ["errand"] });
    renderAt("/labels");
    await userEvent.click(await screen.findByRole("button", { name: "Colour for errand: Default" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Colours for errand" })).toBeNull();
    expect(sentBodies(fetchMock, "PATCH", `/api/labels/01JD${"0".repeat(22)}`)).toEqual([]);
  });

  it("renames a label, and the tasks carry the new name", async () => {
    const fetchMock = stubApi([task({ title: "Water", listId: garden.id, labels: ["wa"] })], { labels: ["wa"] });
    renderAt("/labels");
    await userEvent.click(await screen.findByRole("button", { name: "wa, rename" }));
    const field = screen.getByRole("textbox", { name: "Name of wa" });
    await userEvent.clear(field);
    await userEvent.type(field, "waitingOn{Enter}");
    await waitFor(() => expect(rowOf("waitingOn")).toBeTruthy());
    expect(sentBodies(fetchMock, "PATCH", `/api/labels/01JD${"0".repeat(22)}`)).toEqual([{ name: "waitingOn" }]);
    await waitFor(() => expect(within(rowOf("waitingOn")).getByText("1 open task")).toBeTruthy());
  });

  it("deletes a label after asking, saying how many tasks lose it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubApi([task({ title: "Water", listId: garden.id, labels: ["pri"] })], { labels: ["next", "pri"] });
    renderAt("/labels");
    await waitFor(() => expect(within(rowOf("pri")).getByText("1 open task")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Delete pri" }));
    expect(confirm.mock.calls[0]![0]).toMatch(/Delete the label “pri”\? It comes off the 1 open task that has it/);
    await waitFor(() => expect(rows().getAllByRole("listitem")).toHaveLength(1));
    expect(fetchMock.mock.calls.some(([p, init]) => p === `/api/labels/01JD${"0".repeat(21)}1` && init?.method === "DELETE")).toBe(true);
  });

  it("keeps a label when the deletion isn't confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = stubApi([], { labels: ["pri"] });
    renderAt("/labels");
    await userEvent.click(await screen.findByRole("button", { name: "Delete pri" }));
    expect(rowOf("pri")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("moves between rows with j and k, renames with e t and deletes with Delete", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubApi([], { labels: ["admin", "next", "pri"] });
    renderAt("/labels");
    await screen.findByRole("button", { name: "admin, rename" });
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(rowOf("admin"));
    await userEvent.keyboard("jj");
    expect(document.activeElement).toBe(rowOf("pri"));
    await userEvent.keyboard("k");
    expect(document.activeElement).toBe(rowOf("next"));

    await userEvent.keyboard("et");
    expect(screen.getByRole("textbox", { name: "Name of next" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    rowOf("pri").focus();
    await userEvent.keyboard("{Delete}");
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(rows().getAllByRole("listitem")).toHaveLength(2));
  });

  it("reports a failed change and puts the colour back", async () => {
    stubApi([], { labels: ["errand"], failLabel: true });
    renderAt("/labels");
    await userEvent.click(await screen.findByRole("button", { name: "Colour for errand: Default" }));
    await userEvent.click(screen.getByRole("button", { name: "Teal" }));
    expect(await screen.findByText("Boom")).toBeTruthy();
    await waitFor(() => expect(rowOf("errand").querySelector(".chip")!.hasAttribute("data-color")).toBe(false));
  });
});
