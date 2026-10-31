import { describe, expect, it } from "vitest";
import { PRESETS, presetFor, ruleFor } from "./repeat";

describe("repeat presets", () => {
  it("round trips every preset but custom", () => {
    for (const { id } of PRESETS) if (id !== "custom") expect(presetFor(ruleFor(id))).toBe(id);
  });

  it("gives the rules the server expects", () => {
    expect(ruleFor("none")).toBeNull();
    expect(ruleFor("weekdays")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(ruleFor("fortnightly")).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  it("has no rule for custom", () => {
    expect(() => ruleFor("custom")).toThrow();
  });

  it("matches ignoring case", () => {
    expect(presetFor("freq=monthly")).toBe("monthly");
  });

  it("calls any other rule custom", () => {
    expect(presetFor("FREQ=WEEKLY;BYDAY=SA")).toBe("custom");
    expect(presetFor("FREQ=WEEKLY;INTERVAL=4")).toBe("custom");
  });
});
