import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

const titleBox = () => screen.findByRole("textbox", { name: "Title" }) as Promise<HTMLInputElement>;
const panel = () => screen.getByRole("complementary", { name: "Task details" });

async function openFirst(notes: string | null = null) {
  const tasks = [task({ title: "Weed the beds", listId: garden.id, notes }), task({ title: "Plant tomatoes", listId: garden.id })];
  const fetchMock = stubApi(tasks, { labels: ["errand", "phone"] });
  renderAt(`/list/${garden.id}`);
  await main().findByText("Weed the beds");
  return { tasks, fetchMock };
}

describe("quick editing from the keyboard", () => {
  it("opens the panel on Enter, then puts the cursor in the title on Enter again", async () => {
    await openFirst();
    await userEvent.keyboard("{Enter}");
    const title = await titleBox();
    // Focus went to the panel itself.
    await waitFor(() => expect(document.activeElement).toBe(panel()));
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe("Weed the beds".length);
  });

  it("goes on to the title on Enter from the row when the panel follows the highlight", async () => {
    await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("{Escape}jk"); // Back on the first row, panel closed.
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("j");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Plant tomatoes"));
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
  });

  it("saves the title on Enter and gives the keys back to the panel", async () => {
    const { fetchMock, tasks } = await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("et");
    await userEvent.type(document.activeElement as HTMLElement, "!{Enter}");
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${tasks[0]!.id}`)).toEqual([{ title: "Weed the beds!" }]);
    expect(document.activeElement).toBe(panel());
    await userEvent.keyboard("en");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Notes" }));
  });

  it("edits the title with e t", async () => {
    await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await waitFor(() => expect(document.activeElement).toBe(panel()));
    await userEvent.keyboard("et");
    expect(document.activeElement).toBe(await titleBox());
  });

  it("edits empty notes with e n, and types into the field rather than running keys", async () => {
    const { fetchMock, tasks } = await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("en");
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(document.activeElement).toBe(notes);
    await userEvent.keyboard("hello el");
    expect(notes).toHaveProperty("value", "hello el");
    await userEvent.tab();
    await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${tasks[0]!.id}`)).toEqual([{ notes: "hello el" }]));
  });

  it("turns formatted notes into the editor with e n", async () => {
    await openFirst("Start with the **roses**");
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("en");
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(document.activeElement).toBe(notes);
    expect(notes).toHaveProperty("value", "Start with the **roses**");
  });

  it("focuses Add a label with its list open on e l", async () => {
    await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("el");
    const field = screen.getByRole("combobox", { name: "Add a label" });
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-expanded")).toBe("true");
  });

  it("does nothing with the panel closed but rename on e t", async () => {
    await openFirst();
    await userEvent.keyboard("en");
    expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull();
    await userEvent.keyboard("et");
    expect(document.activeElement).toBe(main().getByRole("textbox", { name: "Title" }));
  });
});
