import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Label } from "@claudia/shared";
import { statusLabels, statusOf, withStatus } from "../lib/status";
import { garden, inbox, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const STATUS = ["next", "waitingOn", "wip", "someday"].map((name) => ({ name, status: true }));
const labels = [...STATUS, "errand", "home"];
const sectionTitles = () => main().getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("status helpers", () => {
  const at = "2026-11-01T00:00:00.000Z";
  const label = (name: string, statusPosition: string | null): Label => ({ id: name, name, color: null, status: statusPosition !== null, statusPosition, createdAt: at });
  const all = [label("wip", "a2"), label("errand", null), label("next", "a0"), label("waitingOn", "a1")];

  it("orders status labels, finds a task's, and replaces it", () => {
    const status = statusLabels(all);
    expect(status.map((l) => l.name)).toEqual(["next", "waitingOn", "wip"]);
    expect(statusOf({ labels: ["errand", "WIP"] }, status)).toBe("WIP");
    expect(statusOf({ labels: ["wip", "next"] }, status)).toBe("next");
    expect(statusOf({ labels: ["errand"] }, status)).toBeNull();
    expect(withStatus(["errand", "wip"], "next", status)).toEqual(["errand", "next"]);
    expect(withStatus(["errand", "wip", "next"], null, status)).toEqual(["errand"]);
  });
});

describe("the task's Status field", () => {
  it("shows the status, changes it in place of the old one, and keeps status labels out of the label picker", async () => {
    const water = task({ title: "Water", listId: garden.id, labels: ["errand", "wip"] });
    const fetchMock = stubApi([water], { labels });
    renderAt(`/list/${garden.id}?task=${water.id}`);
    const panel = within(await screen.findByRole("complementary"));
    const field = (await panel.findByRole("combobox", { name: "Status" })) as HTMLSelectElement;
    await waitFor(() => expect(field.value).toBe("wip"));
    expect([...field.options].map((o) => o.textContent)).toEqual(["None", "next", "waitingOn", "wip", "someday"]);
    // The label chips leave the status out.
    expect(panel.getByRole("button", { name: "Remove label errand" })).toBeTruthy();
    expect(panel.queryByRole("button", { name: "Remove label wip" })).toBeNull();

    await userEvent.selectOptions(field, "waitingon");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ labels: ["errand", "waitingOn"] }]));
    await userEvent.selectOptions(field, "");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`).at(-1)).toEqual({ labels: ["errand"] }));

    await userEvent.click(panel.getByRole("combobox", { name: "Add a label" }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options.some((o) => o?.includes("home"))).toBe(true);
    expect(options.some((o) => o?.includes("next"))).toBe(false);
  });
});

describe("e 1 to e 4 with status labels", () => {
  it("replace the task's status, and say so", async () => {
    const water = task({ title: "Water", listId: garden.id, labels: ["home", "wip"] });
    const fetchMock = stubApi([water], { labels });
    renderAt(`/list/${garden.id}`);
    await main().findByText("Water");
    // The labels load before the keys are pressed.
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.keyboard("je1");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`)).toEqual([{ labels: ["home", "next"] }]));
    expect(await screen.findByText("Changed wip to next")).toBeTruthy();
    await userEvent.keyboard("e1");
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${water.id}`).at(-1)).toEqual({ labels: ["home"] }));
  });
});

describe("the Labels screen", () => {
  it("lists status labels first in their order, turns status on and off, and reorders", async () => {
    const fetchMock = stubApi([], { labels });
    renderAt("/labels");
    const statusList = await main().findByRole("list", { name: "Status labels" });
    const names = (list: HTMLElement) => [...list.querySelectorAll(".label-row .chip")].map((c) => c.textContent);
    expect(names(statusList)).toEqual(["next", "waitingOn", "wip", "someday"]);
    expect(names(main().getByRole("list", { name: "Other labels" }))).toEqual(["errand", "home"]);

    await userEvent.click(main().getByRole("switch", { name: "Status label: errand" }));
    expect(sentBodies(fetchMock, "PATCH", "/api/labels/01JD0000000000000000000004")).toEqual([{ status: true }]);
    await waitFor(() => expect(names(main().getByRole("list", { name: "Status labels" }))).toEqual(["next", "waitingOn", "wip", "someday", "errand"]));

    await userEvent.click(main().getByRole("button", { name: "Move wip up" }));
    expect(sentBodies(fetchMock, "POST", "/api/labels/01JD0000000000000000000002/move")).toEqual([{ beforeId: "01JD0000000000000000000001" }]);
    await waitFor(() => expect(names(main().getByRole("list", { name: "Status labels" }))).toEqual(["next", "wip", "waitingOn", "someday", "errand"]));
    expect((main().getByRole("button", { name: "Move next up" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(main().getByRole("switch", { name: "Status label: next" }));
    await waitFor(() => expect(names(main().getByRole("list", { name: "Other labels" }))).toEqual(["home", "next"]));
  });
});

describe("grouping a search by status", () => {
  it("puts each task under its status, in the status labels' order, then No status", async () => {
    stubApi([
      task({ title: "Beans wip", listId: garden.id, labels: ["wip"] }),
      task({ title: "Beans next", listId: garden.id, labels: ["next"] }),
      task({ title: "Beans plain", listId: inbox.id, labels: ["errand"] }),
    ], { labels });
    renderAt("/search?q=beans&group=status");
    await main().findByText("Beans wip");
    await waitFor(() => expect(sectionTitles()).toEqual(["next", "wip", "No status"]));
    expect((main().getByRole("combobox", { name: "Group" }) as HTMLSelectElement).value).toBe("status");
  });
});
