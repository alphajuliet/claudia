import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { garden, inbox, main, projects, renderAt, stubApi, task, today } from "./testApi";

const sidebar = () => within(screen.getByRole("navigation", { name: "Sidebar" }));
const countOf = (name: string) => sidebar().getByRole("link", { name: new RegExp(`^${name}`) }).querySelector(".nav-count")?.textContent ?? null;

describe("sidebar counts", () => {
  function setup() {
    stubApi([
      task({ title: "Sort the post", listId: inbox.id, dueDate: today }),
      task({ title: "Call Sam", listId: inbox.id, labels: ["next"] }),
      task({ title: "Write the report", listId: projects.id, labels: ["next", "wip"], dueDate: today }),
      task({ title: "Weed the beds", listId: garden.id }),
      task({ title: "Spring", listId: garden.id, kind: "heading" }),
    ]);
    return renderAt("/inbox");
  }

  it("shows open counts beside views and lists", async () => {
    setup();
    await waitFor(() => expect(countOf("Inbox")).toBe("2"));
    expect(countOf("Today")).toBe("2");
    expect(countOf("Next")).toBe("2");
    expect(countOf("WIP")).toBe("1");
    expect(countOf("Waiting")).toBeNull();
    expect(countOf("Projects")).toBe("1");
    // The heading doesn't count.
    expect(countOf("Garden")).toBe("1");
  });

  it("narrows the view counts to the context", async () => {
    setup();
    await waitFor(() => expect(countOf("Next")).toBe("2"));
    await userEvent.click(sidebar().getByRole("button", { name: "Personal" }));
    // Projects is a work list: its task drops out; the Inbox always counts.
    expect(countOf("Next")).toBe("1");
    expect(countOf("Today")).toBe("1");
    expect(countOf("Inbox")).toBe("2");
  });

  it("updates after a task is completed", async () => {
    setup();
    await waitFor(() => expect(countOf("Inbox")).toBe("2"));
    await userEvent.click(await main().findByRole("checkbox", { name: "Complete Call Sam" }));
    await waitFor(() => expect(countOf("Inbox")).toBe("1"));
    expect(countOf("Next")).toBe("1");
  });
});
