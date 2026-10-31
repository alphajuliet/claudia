import { describe, expect, it } from "vitest";
import { dueFields, parseWhen, quickDates } from "./when";

const tz = "Australia/Sydney";
const now = new Date("2026-10-30T23:00:00Z"); // Sat 31 Oct, 10:00 am
const when = (text: string) => parseWhen(text, now, tz);

describe("quickDates", () => {
  it("gives today, tomorrow, the weekend and next Monday", () => {
    expect(quickDates("2026-10-31")).toEqual({ today: "2026-10-31", tomorrow: "2026-11-01", weekend: "2026-10-31", nextWeek: "2026-11-02" });
    expect(quickDates("2026-11-01").weekend).toBe("2026-11-01"); // Sunday
    expect(quickDates("2026-11-02")).toMatchObject({ weekend: "2026-11-07", nextWeek: "2026-11-09" }); // Monday
    expect(quickDates("2026-11-04")).toMatchObject({ weekend: "2026-11-07", nextWeek: "2026-11-09" });
  });
});

describe("dueFields", () => {
  it("sends a date or a time, never both", () => {
    expect(dueFields(null, tz)).toEqual({ dueDate: null, dueAt: null });
    expect(dueFields({ date: "2026-11-03", time: null }, tz)).toEqual({ dueDate: "2026-11-03", dueAt: null });
    expect(dueFields({ date: "2026-11-03", time: "19:00" }, tz)).toEqual({ dueDate: null, dueAt: "2026-11-03T08:00:00.000Z" });
  });
});

describe("parseWhen", () => {
  it("reads relative days at the end", () => {
    expect(when("Call Sam today")).toEqual({ title: "Call Sam", matched: "today", when: { date: "2026-10-31", time: null } });
    expect(when("Call Sam tmr")?.when.date).toBe("2026-11-01");
    expect(when("Call Sam tomorrow")?.when.date).toBe("2026-11-01");
    expect(when("Pay rent in 3 days")?.when.date).toBe("2026-11-03");
    expect(when("Pay rent in 2 weeks")?.when.date).toBe("2026-11-14");
    expect(when("Plan next week")?.when.date).toBe("2026-11-02");
    expect(when("Mow weekend")?.when.date).toBe("2026-10-31");
  });

  it("reads weekdays, today counting, and next as a week later", () => {
    expect(when("Call Sam fri")?.when.date).toBe("2026-11-06");
    expect(when("Call Sam Friday")?.when.date).toBe("2026-11-06");
    expect(when("Call Sam sat")?.when.date).toBe("2026-10-31");
    expect(when("Call Sam next fri")?.when.date).toBe("2026-11-13");
    expect(when("Call Sam on tues")?.when.date).toBe("2026-11-03");
  });

  it("reads day-first dates, rolling a past one to next year", () => {
    expect(when("Pay rent 1 Dec")?.when.date).toBe("2026-12-01");
    expect(when("Pay rent Dec 1")?.when.date).toBe("2026-12-01");
    expect(when("Pay rent 3rd Nov")?.when.date).toBe("2026-11-03");
    expect(when("Pay rent 3/11")?.when.date).toBe("2026-11-03");
    expect(when("Renew 5 Jan 2028")?.when.date).toBe("2028-01-05");
    expect(when("Renew 1/2/2027")?.when.date).toBe("2027-02-01");
    expect(when("Party 20 Oct")?.when.date).toBe("2027-10-20");
    expect(when("Nothing 31/2")).toBeNull();
    // No 29 Feb in 2026, so it is left as text rather than guessed.
    expect(when("Pay 29 Feb")).toBeNull();
  });

  it("reads times, alone or with a day, in either order", () => {
    expect(when("Call Sam fri 3pm")?.when).toEqual({ date: "2026-11-06", time: "15:00" });
    expect(when("Call Sam 3pm fri")?.when).toEqual({ date: "2026-11-06", time: "15:00" });
    expect(when("Call Sam tomorrow at 3:30 pm")?.when).toEqual({ date: "2026-11-01", time: "15:30" });
    expect(when("Call Sam at 3.30pm")?.when).toEqual({ date: "2026-10-31", time: "15:30" });
    expect(when("Call Sam 15:00")?.when).toEqual({ date: "2026-10-31", time: "15:00" });
    expect(when("Lunch noon")?.when).toEqual({ date: "2026-10-31", time: "12:00" });
    // 9 am has passed at 10 am, so it means tomorrow.
    expect(when("Stand-up 9am")?.when).toEqual({ date: "2026-11-01", time: "09:00" });
    // A time equal to now has passed too.
    expect(parseWhen("Stand-up 10am", new Date("2026-10-30T23:00:00Z"), tz)?.when).toEqual({ date: "2026-11-01", time: "10:00" });
    expect(when("Call Sam 3 pm")?.when).toEqual({ date: "2026-10-31", time: "15:00" });
    expect(when("Call Sam at 3 pm")?.when).toEqual({ date: "2026-10-31", time: "15:00" });
    expect(when("x on 3rd Nov 2027 at 3 pm")).toEqual({ title: "x", matched: "on 3rd Nov 2027 at 3 pm", when: { date: "2027-11-03", time: "15:00" } });
  });

  it("only counts the end of the text, and never the whole of it", () => {
    expect(when("Book Friday dinner")).toBeNull();
    expect(when("Read March report")).toBeNull();
    expect(when("Tomorrow")).toBeNull();
    expect(when("Call mum at 5")).toBeNull();
    expect(when("Plan next weekend")).toBeNull();
    expect(when("Do this tomorrow")).toMatchObject({ title: "Do this", when: { date: "2026-11-01" } });
    expect(when("Do this today")).toMatchObject({ title: "Do this", when: { date: "2026-10-31" } });
  });

  it("keeps a number at the end of the title out of the time", () => {
    expect(when("Read chapter 1 2pm")).toMatchObject({ title: "Read chapter 1", when: { time: "14:00" } });
    expect(when("Do item 1 3:30")).toMatchObject({ title: "Do item 1", when: { time: "03:30" } });
    expect(when("Step 1 0:30")).toMatchObject({ title: "Step 1", when: { time: "00:30" } });
    expect(when("Call 3 a")).toBeNull();
    expect(when("Call Sam fri 3pm")?.matched).toBe("fri 3pm");
  });
});
