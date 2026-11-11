import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const row = (title: string) => main().getByText(title).closest("li")!;

describe("label keys", () => {
  it("toggles next, wip, waitingOn and someday with e 1 to e 4", async () => {
    const water = task({ title: "Water", listId: garden.id, labels: ["home"] });
    const fetchMock = stubApi([water]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.keyboard("j");
    await userEvent.keyboard("e1");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ labels: ["home", "next"] }]));
    await userEvent.keyboard("e3");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`).at(-1)).toEqual({ labels: ["home", "next", "waitingOn"] }));
    // Again takes it off, whatever the case it was stored in.
    await userEvent.keyboard("e1");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`).at(-1)).toEqual({ labels: ["home", "waitingOn"] }));
    await userEvent.keyboard("e2e4");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`).at(-1)).toEqual({ labels: ["home", "waitingOn", "wip", "someday"] }));
  });

  it("says what it did, and Undo puts the labels back", async () => {
    const water = task({ title: "Water", listId: garden.id, labels: ["wip"] });
    const fetchMock = stubApi([water]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.keyboard("je2");
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ labels: [] }, { labels: ["wip"] }]));
    expect(screen.queryByText("Removed wip")).toBeNull();
  });

  it("works with the panel open, and does nothing on a heading or with nothing highlighted", async () => {
    const water = task({ title: "Water", listId: garden.id });
    const beds = task({ title: "Beds", listId: garden.id, kind: "heading" });
    const fetchMock = stubApi([beds, water]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    await userEvent.keyboard("e1");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${beds.id}`)).toEqual([]);
    await userEvent.keyboard("j{Enter}");
    await screen.findByRole("textbox", { name: "Title" });
    await userEvent.keyboard("e1");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ labels: ["next"] }]));
    expect(row("Water")).toBeTruthy();
  });
});
