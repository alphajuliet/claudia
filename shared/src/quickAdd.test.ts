import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";

describe("parseQuickAdd", () => {
  it("takes #labels out of the title", () => {
    expect(parseQuickAdd("Call Sam #next #home-phone")).toEqual({ title: "Call Sam", labels: ["next", "home-phone"] });
    expect(parseQuickAdd("#wip Fix the gate #waiting_on")).toEqual({ title: "Fix the gate", labels: ["wip", "waiting_on"] });
  });

  it("collapses and trims whitespace", () => {
    expect(parseQuickAdd("  Buy   #shop  milk  ")).toEqual({ title: "Buy milk", labels: ["shop"] });
  });

  it("drops repeated labels ignoring case, keeping the first spelling", () => {
    expect(parseQuickAdd("Plan #Next trip #next #NEXT")).toEqual({ title: "Plan trip", labels: ["Next"] });
  });

  it("leaves a lone # and # inside a word in the title", () => {
    expect(parseQuickAdd("Fix bug # in C#")).toEqual({ title: "Fix bug # in C#", labels: [] });
    expect(parseQuickAdd("Ticket a#b")).toEqual({ title: "Ticket a#b", labels: [] });
  });

  it("leaves a # word with other characters in the title", () => {
    expect(parseQuickAdd("Room #4.2 booked")).toEqual({ title: "Room #4.2 booked", labels: [] });
  });

  it("uses the text as is when only labels are left", () => {
    expect(parseQuickAdd(" #next ")).toEqual({ title: "#next", labels: [] });
    expect(parseQuickAdd("#a  #b")).toEqual({ title: "#a  #b", labels: [] });
  });

  it("handles plain text and empty input", () => {
    expect(parseQuickAdd("Water the plants")).toEqual({ title: "Water the plants", labels: [] });
    expect(parseQuickAdd("   ")).toEqual({ title: "", labels: [] });
  });
});
