import { describe, expect, it } from "vitest";
import { formatDue, todayIn } from "./dates";

// 2026-10-31 is a Saturday.
const today = "2026-10-31";

describe("formatDue", () => {
  it("names today, tomorrow and yesterday", () => {
    expect(formatDue("2026-10-31", today)).toEqual({ text: "Today", overdue: false });
    expect(formatDue("2026-11-01", today)).toEqual({ text: "Tomorrow", overdue: false });
    expect(formatDue("2026-10-30", today)).toEqual({ text: "Yesterday", overdue: true });
  });

  it("uses the weekday within the coming week", () => {
    expect(formatDue("2026-11-03", today)).toEqual({ text: "Tue", overdue: false });
  });

  it("uses day and month further out or in the past", () => {
    expect(formatDue("2026-11-07", today)).toEqual({ text: "7 Nov", overdue: false });
    expect(formatDue("2026-10-20", today)).toEqual({ text: "20 Oct", overdue: true });
  });

  it("adds the year when it differs", () => {
    expect(formatDue("2027-01-05", today)).toEqual({ text: "5 Jan 2027", overdue: false });
  });
});

describe("todayIn", () => {
  it("gives the date in the time zone", () => {
    expect(todayIn("Australia/Sydney", new Date("2026-10-30T14:00:00Z"))).toBe("2026-10-31");
  });
});
