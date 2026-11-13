import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { errands, garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

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

  it("opens the highlighted task's panel on its notes with e n when the panel is closed", async () => {
    const { tasks } = await openFirst("Start with the **roses**");
    await userEvent.keyboard("en");
    const notes = await screen.findByRole("textbox", { name: "Notes" });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    expect(notes).toHaveProperty("value", "Start with the **roses**");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", tasks[0]!.title);
  });

  it("opens the panel on Add a label, with its list open, with e l when the panel is closed", async () => {
    await openFirst();
    await userEvent.keyboard("jel"); // The second row.
    const field = await screen.findByRole("combobox", { name: "Add a label" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Plant tomatoes");
  });

  it("opens nothing on a heading, and only the field asked for", async () => {
    stubApi([task({ title: "Beds", listId: garden.id, kind: "heading" })]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Beds");
    await userEvent.keyboard("en");
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
  });

  it("moves the task to a list picked by name with e m, with the panel open", async () => {
    const { fetchMock, tasks } = await openFirst();
    await userEvent.keyboard("{Enter}");
    await titleBox();
    await userEvent.keyboard("em");
    const picker = await screen.findByRole("dialog", { name: "Move to a list" });
    const field = screen.getByRole("combobox", { name: "List name" });
    expect(document.activeElement).toBe(field);
    // The task's own list isn't offered.
    expect(within(picker).queryByRole("option", { name: /^Garden/ })).toBeNull();
    await userEvent.keyboard("err{Enter}");
    expect(sentBodies(fetchMock, "POST", `/api/tasks/${tasks[0]!.id}/move`)).toEqual([{ listId: errands.id, atStart: true }]);
    expect(screen.queryByRole("dialog", { name: "Move to a list" })).toBeNull();
    await waitFor(() => expect(main().queryByText("Weed the beds")).toBeNull());
  });

  it("opens the panel and the list picker with e m when the panel is closed, and Escape moves nothing", async () => {
    const { fetchMock, tasks } = await openFirst();
    await userEvent.keyboard("jem");
    await screen.findByRole("dialog", { name: "Move to a list" });
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", tasks[1]!.title);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Move to a list" })).toBeNull();
    // Escape was the picker's: the panel stays open.
    expect(panel()).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([p]) => String(p).endsWith("/move"))).toEqual([]);
  });

  it("opens no picker for a heading", async () => {
    stubApi([task({ title: "Beds", listId: garden.id, kind: "heading" })]);
    renderAt(`/list/${garden.id}`);
    await main().findByText("Beds");
    await userEvent.keyboard("em");
    expect(screen.queryByRole("dialog", { name: "Move to a list" })).toBeNull();
  });

  it("still renames the row in place with e t when the panel is closed", async () => {
    await openFirst();
    await userEvent.keyboard("et");
    expect(document.activeElement).toBe(main().getByRole("textbox", { name: "Title" }));
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
  });

  describe("the date fields from the keyboard", () => {
    const group = (name: string) => within(screen.getByRole("group", { name }));

    it("unfolds Due and puts the cursor in its date with e d, typing there rather than running keys", async () => {
      const { fetchMock, tasks } = await openFirst();
      await userEvent.keyboard("{Enter}");
      await titleBox();
      await userEvent.keyboard("ed");
      const date = group("Due").getByLabelText("Due date");
      expect(document.activeElement).toBe(date);
      expect(group("Due").getByRole("button", { name: "Change due date" }).getAttribute("aria-expanded")).toBe("true");
      // Snooze and Start stay folded.
      expect(screen.queryByLabelText("Snooze date")).toBeNull();
      await userEvent.keyboard("x");
      expect(main().getByText("Weed the beds")).toBeTruthy();
      fireEvent.change(date, { target: { value: "2026-12-25" } });
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${tasks[0]!.id}`)).toEqual([{ dueDate: "2026-12-25", dueAt: null }]));
      expect(document.activeElement).toBe(group("Due").getByRole("button", { name: "Change due date" }));
      expect(panel()).toBeTruthy();
    });

    it("does the same for Start with e s and Snooze with e z", async () => {
      await openFirst();
      await userEvent.keyboard("{Enter}");
      await titleBox();
      await userEvent.keyboard("es");
      expect(document.activeElement).toBe(group("Start").getByLabelText("Start date"));
      await userEvent.keyboard("{Escape}ez");
      expect(document.activeElement).toBe(group("Snooze").getByLabelText("Snooze date"));
    });

    it("opens the panel on the field when it is closed", async () => {
      const { tasks } = await openFirst();
      await userEvent.keyboard("jez");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Snooze date")));
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", tasks[1]!.title);
    });

    it("leaves a heading alone", async () => {
      stubApi([task({ title: "Beds", listId: garden.id, kind: "heading" })]);
      renderAt(`/list/${garden.id}`);
      await main().findByText("Beds");
      await userEvent.keyboard("ed");
      expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
    });
  });
});
