import { describe, expect, it } from "vitest";
import { addDays, formatDue, formatTime, formatWhen, splitIn, todayIn, weekdayOf, zonedToUtc } from "./dates";

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

describe("addDays and weekdayOf", () => {
  it("adds days across a month end and gives the weekday (0 = Sunday)", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(weekdayOf("2026-10-31")).toBe(6);
  });
});

describe("zonedToUtc and splitIn", () => {
  it("turns a Sydney wall time into UTC on both sides of daylight saving", () => {
    expect(zonedToUtc("2026-10-03", "12:00", "Australia/Sydney")).toBe("2026-10-03T02:00:00.000Z");
    expect(zonedToUtc("2026-10-04", "12:00", "Australia/Sydney")).toBe("2026-10-04T01:00:00.000Z");
    expect(zonedToUtc("2026-04-05", "12:00", "Australia/Sydney")).toBe("2026-04-05T02:00:00.000Z");
    expect(zonedToUtc("2026-11-03", "00:00", "Australia/Sydney")).toBe("2026-11-02T13:00:00.000Z");
  });

  it("splits a timestamp into the local date and time", () => {
    expect(splitIn("2026-11-02T13:00:00.000Z", "Australia/Sydney")).toEqual({ date: "2026-11-03", time: "00:00" });
    expect(splitIn("2026-11-03T08:00:00.000Z", "Australia/Sydney")).toEqual({ date: "2026-11-03", time: "19:00" });
  });
});

describe("formatTime and formatWhen", () => {
  it("writes times in 12-hour form", () => {
    expect(formatTime("00:00")).toBe("12:00 am");
    expect(formatTime("12:30")).toBe("12:30 pm");
    expect(formatTime("15:05")).toBe("3:05 pm");
  });

  it("adds the time to the relative date, overdue when it has passed today", () => {
    expect(formatWhen({ date: "2026-11-06", time: "15:00" }, today, "09:00")).toEqual({ text: "Fri, 3:00 pm", overdue: false });
    expect(formatWhen({ date: "2026-10-31", time: "08:00" }, today, "09:00")).toEqual({ text: "Today, 8:00 am", overdue: true });
    expect(formatWhen({ date: "2026-10-31", time: null }, today, "09:00")).toEqual({ text: "Today", overdue: false });
  });
});
