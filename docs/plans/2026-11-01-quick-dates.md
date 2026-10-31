# Quick dates and due times Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One-tap dates, due times and snoozing in the detail panel, and dates typed at the end of quick add (design: `2026-11-01-quick-dates-design.md`).

**Architecture:** Pure date logic in `web/src/lib/dates.ts` (time-zone arithmetic, formatting) and `web/src/lib/when.ts` (quick choices, the quick-add parser, `dueFields`). A new `web/src/ui/DateFields.tsx` holds the panel's Due, Snooze and Start fields built on one `WhenField`. `QuickAdd.tsx` gains the parser and a preview chip. No API change: `dueDate`, `dueAt` and `snoozedUntil` already exist.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest with Testing Library (`npm test -w @claudia/web`).

Conventions: Australian English, small imperative commits ending with the `Co-Authored-By` line, tests first.

---

### Task 1: Time-zone helpers in `dates.ts`

**Files:** Modify `web/src/lib/dates.ts`; Test `web/src/lib/dates.test.ts`.

**Step 1: Failing tests** (append to `dates.test.ts`):

```ts
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
```

Update the import to `import { addDays, formatDue, formatTime, formatWhen, splitIn, todayIn, weekdayOf, zonedToUtc } from "./dates";`.

**Step 2:** `npm test -w @claudia/web -- dates` → FAIL (not exported).

**Step 3: Implement** (append to `dates.ts`):

```ts
/** A day and an optional wall-clock time ("HH:MM") in the user's time zone. */
export interface When { date: string; time: string | null }

export const addDays = (date: string, n: number) => new Date(toUtc(date).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** 0 is Sunday. */
export const weekdayOf = (date: string) => toUtc(date).getUTCDay();

const parts = (timeZone: string, at: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
const offsetAt = (timeZone: string, at: number) => {
  const p = parts(timeZone, new Date(Math.floor(at / 1000) * 1000));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return wall - Math.floor(at / 1000) * 1000;
};

/** A wall-clock date and time in a zone as a UTC timestamp. Checked twice so it holds across a daylight-saving change. */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [h, m] = time.split(":").map(Number);
  const wall = toUtc(date).getTime() + (h! * 60 + m!) * 60_000;
  let at = wall - offsetAt(timeZone, wall);
  at = wall - offsetAt(timeZone, at);
  return new Date(at).toISOString();
}

/** A timestamp as the local date and "HH:MM" in a zone. */
export function splitIn(iso: string, timeZone: string): { date: string; time: string } {
  const p = parts(timeZone, new Date(iso));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "15:05" as "3:05 pm". */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`;
}

/** A When as "Fri, 3:00 pm"; overdue once its day, or its time today, has passed. */
export function formatWhen(when: When, today: string, nowTime: string): { text: string; overdue: boolean } {
  const day = formatDue(when.date, today);
  if (!when.time) return day;
  const overdue = day.overdue || (when.date === today && when.time < nowTime);
  return { text: `${day.text}, ${formatTime(when.time)}`, overdue };
}
```

**Step 4:** `npm test -w @claudia/web -- dates` → PASS.

**Step 5:** Commit `Add time-zone helpers for dates with times`.

---

### Task 2: Quick choices, `dueFields` and the parser in `when.ts`

**Files:** Create `web/src/lib/when.ts`, `web/src/lib/when.test.ts`.

**Step 1: Failing tests.** Fixed now: Saturday 2026-10-31, 10:00 in Sydney (`new Date("2026-10-30T23:00:00Z")`).

```ts
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
  });

  it("only counts the end of the text, and never the whole of it", () => {
    expect(when("Book Friday dinner")).toBeNull();
    expect(when("Read March report")).toBeNull();
    expect(when("Tomorrow")).toBeNull();
    expect(when("Call mum at 5")).toBeNull();
    expect(when("Call Sam fri 3pm")?.matched).toBe("fri 3pm");
  });
});
```

**Step 2:** `npm test -w @claudia/web -- when` → FAIL (module missing).

**Step 3: Implement `when.ts`:**

```ts
import { addDays, splitIn, todayIn, weekdayOf, zonedToUtc, type When } from "./dates";

export type { When };

/** The panel's quick choices for a given today. This weekend is today on a weekend; next week is the coming Monday. */
export function quickDates(today: string) {
  const day = weekdayOf(today);
  return {
    today,
    tomorrow: addDays(today, 1),
    weekend: day === 0 || day === 6 ? today : addDays(today, 6 - day),
    nextWeek: addDays(today, (8 - day) % 7 || 7),
  };
}

/** The due fields for a When: a date alone is `dueDate`, a date with a time is `dueAt`. Never both. */
export const dueFields = (when: When | null, timeZone: string) =>
  !when ? { dueDate: null, dueAt: null }
  : when.time ? { dueDate: null, dueAt: zonedToUtc(when.date, when.time, timeZone) }
  : { dueDate: when.date, dueAt: null };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Index of a name given as at least its first three letters ("fri", "tues", "sept"), or -1. */
const named = (names: string[], word: string) => (word.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1);

/** A real calendar date, or null (31/2). */
function calendar(y: number, m: number, d: number): string | null {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? at.toISOString().slice(0, 10) : null;
}

/** A day and month with an optional year; without one, a day already gone this year is next year's. */
function dayMonth(d: number, m: number, year: string | undefined, today: string): string | null {
  if (year) return calendar(Number(year), m, d);
  const y = Number(today.slice(0, 4));
  const date = calendar(y, m, d);
  return date && date < today ? calendar(y + 1, m, d) : date;
}

const ORDINAL = "(\\d{1,2})(?:st|nd|rd|th)?";

/** All of `words` as a date, or null. */
function parseDate(words: string[], today: string): string | null {
  if (words[0] === "on" && words.length > 1) words = words.slice(1);
  const s = words.join(" ");
  if (s === "today" || s === "tod") return today;
  if (s === "tomorrow" || s === "tmr" || s === "tmrw") return addDays(today, 1);
  if (s === "weekend" || s === "this weekend") return quickDates(today).weekend;
  if (s === "next week") return quickDates(today).nextWeek;
  let m = /^in (\d{1,3}) (days?|weeks?)$/.exec(s);
  if (m) return addDays(today, Number(m[1]) * (m[2]!.startsWith("week") ? 7 : 1));
  m = /^(next |this )?([a-z]+)$/.exec(s);
  if (m) {
    const day = named(DAYS, m[2]!);
    if (day >= 0) {
      const ahead = (day - weekdayOf(today) + 7) % 7;
      return addDays(today, ahead + (m[1] === "next " ? 7 : 0));
    }
  }
  m = new RegExp(`^${ORDINAL} ([a-z]+)(?: (\\d{4}))?$`).exec(s);
  if (m && named(MONTHS, m[2]!) >= 0) return dayMonth(Number(m[1]), named(MONTHS, m[2]!) + 1, m[3], today);
  m = new RegExp(`^([a-z]+) ${ORDINAL}(?: (\\d{4}))?$`).exec(s);
  if (m && named(MONTHS, m[1]!) >= 0) return dayMonth(Number(m[2]), named(MONTHS, m[1]!) + 1, m[3], today);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s);
  if (m) return dayMonth(Number(m[1]), Number(m[2]), m[3], today);
  return null;
}

const hhmm = (h: number, min: number) => `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

/** All of `words` as a time ("HH:MM"), or null. A bare number is not a time. */
function parseTime(words: string[]): string | null {
  if (words[0] === "at" && words.length > 1) words = words.slice(1);
  const s = words.join("");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)$/.exec(s);
  if (m) {
    const h = Number(m[1]), min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    return hhmm((h % 12) + (m[3]!.startsWith("p") ? 12 : 0), min);
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return hhmm(Number(m[1]), Number(m[2]));
  return null;
}

/** All of `words` as a day, a time, or both in either order. */
function parseTail(words: string[], today: string): { date: string | null; time: string | null } | null {
  const date = parseDate(words, today);
  if (date) return { date, time: null };
  const time = parseTime(words);
  if (time) return { date: null, time };
  for (let k = 1; k < words.length; k++) {
    const [a, b] = [words.slice(0, k), words.slice(k)];
    const dt = parseDate(a, today), tt = parseTime(b);
    if (dt && tt) return { date: dt, time: tt };
    const td = parseTime(a), dd = parseDate(b, today);
    if (td && dd) return { date: dd, time: td };
  }
  return null;
}

const MAX_TAIL = 6;
const word = (w: string) => w.toLowerCase().replace(/[,.]+$/, "");

/**
 * A date or time at the end of quick-add text: the longest tail of words that reads as one, leaving at least one word
 * of title. `matched` is the tail as typed. A time alone is today, or tomorrow once it has passed.
 */
export function parseWhen(text: string, now: Date, timeZone: string): { title: string; matched: string; when: When } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const today = todayIn(timeZone, now);
  for (let i = Math.max(1, words.length - MAX_TAIL); i < words.length; i++) {
    const tail = parseTail(words.slice(i).map(word), today);
    if (!tail) continue;
    const date = tail.date ?? (tail.time! > splitIn(now.toISOString(), timeZone).time ? today : addDays(today, 1));
    return { title: words.slice(0, i).join(" "), matched: words.slice(i).join(" "), when: { date, time: tail.time } };
  }
  return null;
}
```

Note `word()` strips a trailing `.` so `3.30pm` is untouched (the dot is inside) but "fri." reads as "fri".

**Step 4:** `npm test -w @claudia/web -- when` → PASS. Fix the parser, not the tests, if a case fails, unless the case contradicts the design.

**Step 5:** Commit `Add quick date choices and a quick-add date parser`.

---

### Task 3: `WhenField` and the Due field

**Files:** Create `web/src/ui/DateFields.tsx`; Modify `web/src/ui/TaskFields.tsx` (export `Field`, `usePatch`, `SaveState`; move `DateInput`, `formatDueAt`, `DateFields` out), `web/src/ui/TaskDetail.tsx` (import `DateFields` from `./DateFields`, pass `onClose`), `web/src/styles.css`; Test `web/src/ui/TaskDetail.test.tsx`.

**Step 1: Update and add tests** in `TaskDetail.test.tsx` (`describe("dates")` block, replacing "sets and clears the due date", "shows a due time read-only" and the rapid date-change test's lookups):

- The Due group is `p.getByRole("group", { name: "Due" })`; its inputs are labelled `Due date` and `Due time`.
- "sets and clears the due date": change `Due date` to `2026-11-05` → bodies `[{ dueDate: "2026-11-05", dueAt: null }]`; Clear due date → `{ dueDate: null, dueAt: null }`.
- "a quick button sets the day and keeps the time": a task with `dueAt: "2026-11-03T08:00:00.000Z"` (19:00 Sydney); click `Tomorrow` → body `{ dueDate: null, dueAt: zonedToUtc(addDays(today, 1), "19:00", tz) }`.
- "adding a time moves the date to dueAt": task with `dueDate: "2026-11-05"`; change `Due time` to `09:30`, blur → `{ dueDate: null, dueAt: "2026-11-04T22:30:00.000Z" }`.
- "clearing the time keeps the day": task with dueAt as above; change `Due time` to `""`, blur → `{ dueDate: "2026-11-03", dueAt: null }`.
- "shows a due time": group text contains `3 Nov, 7:00 pm` or the relative form; assert with `formatWhen` from `../lib/dates` rather than a literal, since today moves.
- "a repeating task can't take a time": task with `recurRule: "FREQ=WEEKLY", recurFrom: "due"`; `Due time` is disabled and the text "Times on repeating tasks are coming" shows.
- The rapid-change test: use `p.getByLabelText("Due date")`; expected bodies gain `dueAt: null`.

**Step 2:** `npm test -w @claudia/web -- TaskDetail` → the new and changed tests FAIL.

**Step 3: Implement.**

In `TaskFields.tsx`: `export` `Field`, `usePatch` and `type SaveState`; delete `DATE`, `DATE_IDLE_MS`, `DateInput`, `formatDueAt`, `DateFields` (they move). Remove the `todayIn` import if unused.

`DateFields.tsx`:

- `IdleInput({ type, label, value, complete, disabled, onSave })`: the old `DateInput` body without its `Field` wrapper and Clear button, generalised: `type` is `"date"` or `"time"`; `complete(v)` says a typed value is whole (date: the year ≥ 1900; time: `/^\d{2}:\d{2}$/`); a complete value saves after `DATE_IDLE_MS` idle, any value (whole or `""`) on blur, and a pending save flushes on unmount. Keep the old comments.
- `WhenField({ label, name, value, choices, today, nowTime, timeDisabled, showOverdue, status, onSave })`:
  - `Field label={label} group`, containing:
    - `.when-current`: the `formatWhen` text (class `due overdue` when `showOverdue` and overdue) or a muted "None"; Clear (`aria-label={\`Clear ${name}\`}`) when set; `FieldStatus`.
    - `.when-choices`: one `button.quiet.small` per choice. A choice is `{ label, date, time? }`; clicking saves `{ date, time: choice.time ?? value?.time ?? null }`.
    - `.when-inputs`: `IdleInput type="date" label={\`${label} date\`}` saving `{ date, time: value?.time ?? null }` (`""` saves null); `IdleInput type="time" label={\`${label} time\`}` saving `{ date: value?.date ?? today, time }`, or `{ date: value.date, time: null }` for `""` (null when there's no date).
    - When `timeDisabled`, a `p.when-note.muted`: "Times on repeating tasks are coming".
- `DueField({ task, timeZone })`: `value = task.dueAt ? splitIn(task.dueAt, timeZone) : task.dueDate ? { date: task.dueDate, time: null } : null`; choices Today, Tomorrow, This weekend, Next week from `quickDates(today)`; `timeDisabled={Boolean(task.recurRule)}`; `showOverdue`; `onSave={(w) => void patch(dueFields(w, timeZone))}`. `today = todayIn(timeZone)`, `nowTime = splitIn(new Date().toISOString(), timeZone).time`.
- `DateFields({ task, timeZone, onClose })` renders `DueField` (Snooze and Start come in Task 4).

`TaskDetail.tsx`: `import { DateFields } from "./DateFields";` and render `<DateFields task={task} timeZone={timeZone} onClose={onClose} />`.

`styles.css` (next to the other `.detail-*` rules):

```css
.when { display: grid; gap: 0.35rem; width: 100%; padding: 0.15rem 0; }
.when-current { display: flex; align-items: center; gap: 0.5rem; min-height: 1.9rem; }
.when-choices { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.when-inputs { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.when-inputs .detail-date { border-color: var(--border); }
.when-note { font-size: 0.85rem; }
@media (pointer: coarse) {
  .when-choices button.quiet.small { min-height: 2.25rem; padding: 0.3rem 0.75rem; }
}
```

Give both `IdleInput`s the `detail-date` class.

**Step 4:** `npm test -w @claudia/web` and `npm run typecheck` → PASS.

**Step 5:** Commit `Add quick dates and due times to the task panel`.

---

### Task 4: Snooze and a read-only Start

**Files:** Modify `web/src/ui/DateFields.tsx`; Test `web/src/ui/TaskDetail.test.tsx`.

**Step 1: Failing tests:**

- "snoozes with a quick choice, closes the panel and offers Undo": open a task on its list; in group `Snooze` click `Tomorrow` → PATCH `{ snoozedUntil: zonedToUtc(addDays(today, 1), "00:00", tz) }`; the panel closes; the toast reads `Snoozed until Tomorrow`; clicking `Undo` sends `{ snoozedUntil: null }`.
- "a past snooze shows as none": task with `snoozedUntil: "2020-01-01T00:00:00.000Z"`; group `Snooze` contains "None" and no `Clear snooze` button.
- "a snoozed task shows its snooze with Clear": task snoozed to a future date (open via `/search?q=...&task=` or directly by list URL with `?task=`); `Clear snooze` sends `{ snoozedUntil: null }` and does not close the panel.
- "shows a start date read-only, with Clear": task with `startDate: "2026-11-01"`; group `Start` shows text and `Clear start date` sends `{ startDate: null }`; a task without one has no `Start` group.

**Step 2:** Run → FAIL.

**Step 3: Implement** in `DateFields.tsx`:

- `SnoozeField({ task, timeZone, onClose })`:
  - `value`: `isSnoozed(task)` (from `../lib/tasks`) ? `splitIn(task.snoozedUntil!, timeZone)` with `time: "00:00"` shown as `null` : `null`.
  - Choices: This evening `{ date: today, time: "18:00" }` while `nowTime < "18:00"`; Tomorrow, This weekend, Next week with `time: null`, leaving out any whose date is today with no time (This weekend at the weekend).
  - `onSave(w)`: `snoozedUntil = w ? zonedToUtc(w.date, w.time ?? "00:00", timeZone) : null`. If it's in the future, call `onClose()` at once; after the patch resolves `true`, `toast.show({ message: \`Snoozed until ${formatWhen(...).text}\`, action: { label: "Undo", run: () => void update.mutateAsync({ id: task.id, patch: { snoozedUntil: previous } }).catch((e: Error) => toast.show({ message: e.message, error: true })) } })`, with `previous = task.snoozedUntil` captured before saving and `update = useUpdateTask()`.
  - `timeDisabled={false}`, no overdue colour.
- `StartField({ task })`: only when `task.startDate`; `Field label="Start" group` with `formatDue(task.startDate, today).text` and `Clear` (`aria-label="Clear start date"`) patching `{ startDate: null }`.
- `DateFields` renders Due, Snooze, then Start.

If the Undo mutation does not run after the panel unmounts (TanStack Query v5 keeps running a mutation started by an unmounted observer, but check), move the snooze toast into a hook used by `Body` in `TaskDetail.tsx`, which stays mounted.

**Step 4:** `npm test -w @claudia/web` and `npm run typecheck` → PASS.

**Step 5:** Commit `Snooze tasks from the panel and show a start date only when set`.

---

### Task 5: Dates in quick add

**Files:** Modify `web/src/ui/QuickAdd.tsx`, `web/src/styles.css`; Test `web/src/ui/editing.test.tsx` (the quick-add tests live there; check with `grep -n "Add a task" web/src/ui/*.test.tsx`).

**Step 1: Failing tests:**

- "a date at the end sets the due date": on a list, type `Call Sam tomorrow` → the preview `Due Tomorrow` shows; Enter → POST body has `title: "Call Sam"`, `dueDate: addDays(today, 1)` and no `dueAt`.
- "a time sets dueAt": type `Call Sam tomorrow 3pm` → body has `dueAt: zonedToUtc(addDays(today, 1), "15:00", tz)` and no `dueDate`.
- "the preview's × keeps the words": type `Read chapter 3/4`, click the button named `Keep “3/4” in the title` → preview gone; Enter → `title: "Read chapter 3/4"`, no due fields.
- "labels and a date together": `Pay rent #home 1 Dec` → `title: "Pay rent"`, `labels: ["home"]`, `dueDate` = 1 Dec (this or next year, worked out as in the parser).
- "on Today a parsed date wins over today": on `/today`, `Call Sam tomorrow` → `dueDate` is tomorrow.

**Step 2:** Run → FAIL.

**Step 3: Implement** in `QuickAdd.tsx`:

```tsx
const [dismissed, setDismissed] = useState<string | null>(null);
const parsed = parseQuickAdd(text);
const found = parseWhen(parsed.title, new Date(), timeZone);
const when = found && found.matched !== dismissed ? found : null;
```

- In `submit`, title is `when ? when.title : parsed.title`; due fields are `when ? dueFields(when.when, timeZone)` with nulls dropped (`Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null))`), else the existing `dueToday` field. Reset `dismissed` to null with the text.
- Below the input, while `when` is set:

```tsx
<div className="quick-add-when">
  <span>Due {formatWhen(when.when, todayIn(timeZone), nowTime).text}</span>
  <button type="button" className="chip-remove" aria-label={`Keep “${when.matched}” in the title`} onClick={() => { setDismissed(when.matched); input.current?.focus(); }}>
    <span aria-hidden="true">×</span>
  </button>
</div>
```

  The quick-add wrapper must allow the chip on its own line: wrap the existing `.quick-add` row and the chip in a `<div className="quick-add-wrap">`, or add `flex-wrap: wrap` to `.quick-add` and give `.quick-add-when` `flex-basis: 100%`. Pick whichever keeps the existing tests' DOM queries working.
- When the task has a parsed date and `announce` is false, still toast `Added, due Tomorrow`: the task may leave the screen (on Today with a future date). When `announce` is true: `Added to Inbox, due Tomorrow`.

CSS:

```css
.quick-add-when { display: inline-flex; align-items: center; gap: 0.3rem; margin: 0.15rem 0 0 1.9rem; padding: 0.1rem 0.25rem 0.1rem 0.55rem; font-size: 0.85rem; color: var(--accent); background: var(--accent-soft); border-radius: 999px; }
```

**Step 4:** `npm test -w @claudia/web`, `npm run typecheck`, `npm run build` → PASS.

**Step 5:** Commit `Read a due date or time at the end of quick add`.

---

### Task 6: Check it in the browser, then document

1. `npm run dev`, open http://localhost:8787 at desktop width and in a phone-sized window. Check: quick buttons, adding a time, clearing it, the disabled time on a repeating task, snoozing a task off Today and Undo, the quick-add chip and its ×, dark mode. On iOS the native date and time pickers should open (check after deploy).
2. Design doc: set `Status: approved; built.` and note any deviations.
3. Obsidian note: mark the 2026-11-01 decision as built, with the deviations.
4. Commit `Mark quick dates and due times as built`.
5. Board: after Andrew confirms the push and deploy, move "Quick dates and due times" to DONE.
