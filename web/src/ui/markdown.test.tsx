import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, main, renderAt, sentBodies, stubApi, task } from "./testApi";

describe("Markdown in titles", () => {
  it("renders inline marks in a row's title and keeps block syntax as text", async () => {
    stubApi([
      task({ title: "Buy **compost** and `mulch`", listId: garden.id }),
      task({ title: "1. Call Sam", listId: garden.id }),
      task({ title: "# 3 things", listId: garden.id }),
    ]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByRole("button", { name: "Buy compost and mulch" });
    expect(title.querySelector("strong")?.textContent).toBe("compost");
    expect(title.querySelector("code")?.textContent).toBe("mulch");
    expect(main().getByRole("button", { name: "1. Call Sam" })).toBeTruthy();
    expect(main().getByRole("button", { name: "# 3 things" })).toBeTruthy();
  });

  it("never renders HTML from a title", async () => {
    stubApi([task({ title: 'Look <img src="x" onerror="alert(1)"> here', listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const title = await main().findByRole("button", { name: /Look/ });
    expect(title.querySelector("img")).toBeNull();
    expect(title.textContent).toContain("<img");
  });

  it("opens links in a new tab without starting a rename, and drops unsafe ones", async () => {
    stubApi([task({ title: "Read [the docs](https://example.com/docs) and [this](javascript:alert(1))", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const link = await main().findByRole("link", { name: "the docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The unsafe link is left as its text.
    expect(main().queryByRole("link", { name: "this" })).toBeNull();
    expect(link.closest(".task-title")!.textContent).toBe("Read the docs and this");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull();
  });

  it("shows a heading's Markdown without links", async () => {
    stubApi([task({ title: "**Spring** [plan](https://example.com)", listId: garden.id, kind: "heading" })]);
    renderAt(`/list/${garden.id}`);
    const heading = await main().findByRole("button", { name: "Spring plan" });
    expect(heading.querySelector("strong")).toBeTruthy();
    expect(heading.querySelector("a")).toBeNull();
  });

  it("edits the raw title", async () => {
    stubApi([task({ title: "Buy **compost**", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    await userEvent.click(await main().findByRole("button", { name: "Buy compost" }));
    expect((main().getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Buy **compost**");
  });
});

describe("Markdown in notes", () => {
  it("shows notes formatted, edits the raw text on click, and shows them formatted again after saving", async () => {
    const t = task({ title: "Plan the beds", listId: garden.id, notes: "- tomatoes\n- **basil**\n\nSee [guide](https://example.com)" });
    const fetchMock = stubApi([t]);
    renderAt(`/list/${garden.id}?task=${t.id}`);
    const notes = await screen.findByRole("group", { name: /Notes/ });
    expect(notes.querySelectorAll("li")).toHaveLength(2);
    expect(notes.querySelector("strong")?.textContent).toBe("basil");
    expect(screen.getByRole("link", { name: "guide" }).getAttribute("target")).toBe("_blank");

    await userEvent.click(notes.querySelector("li")!);
    const field = (await screen.findByRole("textbox", { name: "Notes" })) as HTMLTextAreaElement;
    expect(field.value).toBe(t.notes);
    await waitFor(() => expect(document.activeElement).toBe(field));
    await userEvent.type(field, "\n- chives");
    await userEvent.click(screen.getByRole("heading", { name: "Subtasks" }));
    expect(sentBodies(fetchMock, "PATCH", `/api/tasks/${t.id}`)).toEqual([{ notes: `${t.notes}\n- chives` }]);
    await waitFor(() => expect(screen.getByRole("group", { name: /Notes/ }).querySelectorAll("li")).toHaveLength(3));
  });

  it("opens the editor with Enter on the notes", async () => {
    const t = task({ title: "Plan the beds", listId: garden.id, notes: "Some *notes*" });
    stubApi([t]);
    renderAt(`/list/${garden.id}?task=${t.id}`);
    const notes = await screen.findByRole("group", { name: /Notes/ });
    notes.focus();
    await userEvent.keyboard("{Enter}");
    expect(((await screen.findByRole("textbox", { name: "Notes" })) as HTMLTextAreaElement).value).toBe("Some *notes*");
  });

  it("shows the editor straight away when there are no notes", async () => {
    const t = task({ title: "Plan the beds", listId: garden.id });
    stubApi([t]);
    renderAt(`/list/${garden.id}?task=${t.id}`);
    expect(((await screen.findByRole("textbox", { name: "Notes" })) as HTMLTextAreaElement).placeholder).toBe("Notes");
  });

  it("keeps images, footnotes and tables out of titles", async () => {
    stubApi([
      task({ title: "See ![chart](https://example.com/c.png) now", listId: garden.id }),
      task({ title: "[^1]: a footnote", listId: garden.id }),
      task({ title: "a | b\n-|-", listId: garden.id }),
    ]);
    renderAt(`/list/${garden.id}`);
    await main().findByText(/See/);
    const titles = [...document.querySelectorAll("main .task-title")];
    expect(titles.map((t) => t.querySelector("img, table, section"))).toEqual([null, null, null]);
    expect(titles[1]!.textContent).toBe("[^1]: a footnote");
  });

  it("opens Enter on a link in a title as the link, not a rename", async () => {
    stubApi([task({ title: "Read [spec](https://example.com/spec)", listId: garden.id })]);
    renderAt(`/list/${garden.id}`);
    const link = await main().findByRole("link", { name: "spec" });
    link.focus();
    await userEvent.keyboard("{Enter}");
    expect(main().queryByRole("textbox", { name: "Title" })).toBeNull();
  });
});
