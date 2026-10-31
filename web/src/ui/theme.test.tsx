import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, savedTheme } from "./theme";
import { renderAt, stubApi } from "./testApi";

afterEach(() => applyTheme("system"));

describe("theme", () => {
  it("saves light and dark, and System forgets the choice", () => {
    expect(savedTheme()).toBe("system");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("claudia.theme")).toBe("dark");
    expect(savedTheme()).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("claudia.theme")).toBeNull();
  });

  it("switches from the sidebar and shows the saved choice", async () => {
    localStorage.setItem("claudia.theme", "light");
    stubApi([]);
    renderAt("/inbox");
    const group = within(await screen.findByRole("group", { name: "Theme" }));
    expect(group.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(group.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(group.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(group.getByRole("button", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("claudia.theme")).toBeNull();
  });
});
