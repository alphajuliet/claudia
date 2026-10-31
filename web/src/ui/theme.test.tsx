import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, savedTheme } from "./theme";
import { renderAt, stubApi } from "./testApi";

afterEach(() => applyTheme("system"));

describe("theme", () => {
  it("points the theme-color metas at the chosen theme, and each back at its own scheme for System", () => {
    const metas = (["light", "dark"] as const).map((scheme) => {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = `(prefers-color-scheme: ${scheme})`;
      document.head.append(meta);
      return meta;
    });
    try {
      applyTheme("dark");
      expect(metas.map((m) => m.content)).toEqual(["#1b1c1f", "#1b1c1f"]);
      applyTheme("light");
      expect(metas.map((m) => m.content)).toEqual(["#ffffff", "#ffffff"]);
      applyTheme("system");
      expect(metas.map((m) => m.content)).toEqual(["#ffffff", "#1b1c1f"]);
    } finally {
      metas.forEach((m) => m.remove());
    }
  });

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
