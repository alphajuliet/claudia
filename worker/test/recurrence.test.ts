import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isValidRule, nextDueDate, startOfDayIn, todayIn } from "../src/lib/recurrence";

describe("nextDueDate, repeat from due", () => {
  it("completed late: next occurrence after today, not after the old due date", () => {
    // Due Sat 24 Oct, completed Wed 4 Nov: next Saturday is 7 Nov.
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SA", "due", "2026-10-24", "2026-11-04")).toBe("2026-11-07");
  });
  it("completed on the due day: the next occurrence", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SA", "due", "2026-10-24", "2026-10-24")).toBe("2026-10-31");
  });
  it("completed early: the occurrence after the current due date", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=SA", "due", "2026-10-31", "2026-10-27")).toBe("2026-11-07");
  });
  it("keeps the fortnightly phase when late", () => {
    // Due Sat 24 Oct, every 2 weeks: 24 Oct, 7 Nov, 21 Nov. Completed Wed 4 Nov -> 7 Nov.
    expect(nextDueDate("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", "due", "2026-10-24", "2026-11-04")).toBe("2026-11-07");
    // Completed Sun 8 Nov -> 21 Nov (not 14 Nov).
    expect(nextDueDate("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", "due", "2026-10-24", "2026-11-08")).toBe("2026-11-21");
  });
  it("handles a BYDAY list", () => {
    // Mon, Wed, Fri. Due Wed 28 Oct, completed that day -> Fri 30 Oct.
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=MO,WE,FR", "due", "2026-10-28", "2026-10-28")).toBe("2026-10-30");
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=MO,WE,FR", "due", "2026-10-30", "2026-10-30")).toBe("2026-11-02");
  });
  it("handles plain weekly, daily, monthly and yearly", () => {
    expect(nextDueDate("FREQ=WEEKLY", "due", "2026-10-26", "2026-10-26")).toBe("2026-11-02");
    expect(nextDueDate("FREQ=DAILY", "due", "2026-10-26", "2026-10-26")).toBe("2026-10-27");
    expect(nextDueDate("FREQ=MONTHLY", "due", "2026-10-15", "2026-10-15")).toBe("2026-11-15");
    expect(nextDueDate("FREQ=YEARLY", "due", "2026-03-01", "2026-10-26")).toBe("2027-03-01");
  });
  it("uses today as the start when there is no due date", () => {
    expect(nextDueDate("FREQ=WEEKLY", "due", null, "2026-10-26")).toBe("2026-11-02");
  });
});

describe("nextDueDate, repeat from completion", () => {
  it("counts from today whatever the old due date was", () => {
    expect(nextDueDate("FREQ=DAILY", "completion", "2026-10-01", "2026-10-26")).toBe("2026-10-27");
    expect(nextDueDate("FREQ=DAILY;INTERVAL=2", "completion", "2026-10-01", "2026-10-26")).toBe("2026-10-28");
    expect(nextDueDate("FREQ=WEEKLY;INTERVAL=5", "completion", null, "2026-10-26")).toBe("2026-11-30");
    expect(nextDueDate("FREQ=MONTHLY", "completion", null, "2026-10-26")).toBe("2026-11-26");
  });
});

describe("nextDueDate, finished rules", () => {
  it("returns null when the rule has run out", () => {
    expect(nextDueDate("FREQ=DAILY;COUNT=1", "due", "2026-10-26", "2026-10-26")).toBeNull();
    expect(nextDueDate("FREQ=DAILY;UNTIL=20261001T000000Z", "due", "2026-09-30", "2026-10-26")).toBeNull();
  });
});

describe("isValidRule", () => {
  // Every distinct rule found in production on 2026-10-26.
  const production = [
    "FREQ=YEARLY", "FREQ=WEEKLY;BYDAY=SA", "FREQ=DAILY", "FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
    "FREQ=DAILY;INTERVAL=2", "FREQ=MONTHLY", "FREQ=WEEKLY;BYDAY=FR", "FREQ=WEEKLY;BYDAY=MO",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR", "FREQ=WEEKLY;BYDAY=SU,TU,TH,SA", "FREQ=WEEKLY;BYDAY=TH",
    "FREQ=WEEKLY;INTERVAL=2", "FREQ=WEEKLY;INTERVAL=4", "FREQ=WEEKLY;INTERVAL=5",
  ];
  it.each(production)("accepts %s and can advance it", (rule) => {
    expect(isValidRule(rule)).toBe(true);
    expect(nextDueDate(rule, "due", "2026-10-26", "2026-10-26")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it.each(["", "nonsense", "INTERVAL=2", "FREQ=HOURLY", "FREQ=MINUTELY", "FREQ=SECONDLY", "FREQ=WEEKLY;BYDAY=XX"])(
    "rejects %j",
    (rule) => expect(isValidRule(rule)).toBe(false),
  );
});

describe("date helpers", () => {
  it("adds and counts days", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-24", "2026-11-07")).toBe(14);
    expect(daysBetween("2026-11-07", "2026-10-24")).toBe(-14);
  });
  it("gives today's date in a time zone", () => {
    const at = new Date("2026-10-25T15:30:00Z"); // 02:30 on the 26th in Sydney
    expect(todayIn("Australia/Sydney", at)).toBe("2026-10-26");
    expect(todayIn("UTC", at)).toBe("2026-10-25");
  });
});

describe("startOfDayIn", () => {
  it("is local midnight as a UTC instant", () => {
    expect(startOfDayIn("2026-11-02", "Australia/Sydney").toISOString()).toBe("2026-11-01T13:00:00.000Z"); // AEDT, +11
    expect(startOfDayIn("2026-07-01", "Australia/Sydney").toISOString()).toBe("2026-06-30T14:00:00.000Z"); // AEST, +10
    expect(startOfDayIn("2026-11-02", "UTC").toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(startOfDayIn("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("handles the days Sydney changes its clocks", () => {
    // Daylight saving starts at 2am on Sun 4 Oct 2026 and ends at 3am on Sun 5 Apr 2026: midnight is before both.
    expect(startOfDayIn("2026-10-04", "Australia/Sydney").toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(startOfDayIn("2026-10-05", "Australia/Sydney").toISOString()).toBe("2026-10-04T13:00:00.000Z");
    expect(startOfDayIn("2026-04-05", "Australia/Sydney").toISOString()).toBe("2026-04-04T13:00:00.000Z");
    expect(startOfDayIn("2026-04-06", "Australia/Sydney").toISOString()).toBe("2026-04-05T14:00:00.000Z");
  });
});
