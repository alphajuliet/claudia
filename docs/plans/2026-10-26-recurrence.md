# Recurrence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completing a recurring task advances it in place to its next due date and logs a `completed` event.

**Architecture:** A pure `worker/src/lib/recurrence.ts` (built on `rrule`) computes the next date. `setCompleted` in `worker/src/routes/tasks.ts` uses it for open recurring tasks. Create and update validate the rule. Design: `docs/plans/2026-10-26-recurrence-design.md`.

**Tech Stack:** `rrule` (pure JS), Hono, Drizzle over D1, vitest in workerd.

---

Conventions: Australian English. Small commits with imperative messages ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Run commands from the repo root. Never print or commit secrets.

### Task 1: The recurrence module

**Files:**
- Modify: `worker/package.json` (add `rrule` dependency via npm)
- Create: `worker/src/lib/recurrence.ts`
- Test: `worker/test/recurrence.test.ts`

**Step 1:** `npm install -w @claudia/worker rrule`. Then write a throwaway check that `import { RRule } from "rrule"` works inside workerd (the first test run proves it). If the default import fails to resolve or run in vitest-pool-workers, report the exact error rather than switching libraries.

**Step 2: Write the failing tests** (`worker/test/recurrence.test.ts`). Dates below are fixed so the cases are readable. 2026-10-24 is a Saturday.

```ts
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isValidRule, nextDueDate, todayIn } from "../src/lib/recurrence";

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
```

If any expected date above is wrong because the test author miscounted (check against a calendar), fix the test, not the code, and say so. Also check `INTERVAL=5` from 2026-10-26 plus 5 weeks = 2026-11-30.

**Step 3: Run to see it fail:** `npm test -w @claudia/worker -- recurrence`. Expected: FAIL, module missing.

**Step 4: Implement** `worker/src/lib/recurrence.ts`:

```ts
import { RRule } from "rrule";

export const DEFAULT_TIME_ZONE = "Australia/Sydney";
const DAY_MS = 86_400_000;

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const toDate = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => toDate(new Date(toUtc(date).getTime() + days * DAY_MS));
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);

/** Today's date (YYYY-MM-DD) in a time zone. */
export const todayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** A rule we can advance: parses, has a FREQ, and is no finer than daily (so the calculation stays cheap). */
export function isValidRule(rule: string): boolean {
  try {
    const { freq } = RRule.parseString(rule);
    return freq !== undefined && freq <= RRule.DAILY;
  } catch {
    return false;
  }
}

/**
 * The next due date (YYYY-MM-DD) after completing a recurring task, or null if the rule has run out.
 * From `due`: the first occurrence after the later of the old due date and today, keeping the rule's
 * phase. From `completion` (or with no due date): the first occurrence after today.
 */
export function nextDueDate(rule: string, from: "due" | "completion", due: string | null, today: string): string | null {
  const fromDue = from === "due" && due !== null;
  const anchor = fromDue ? due : today;
  const after = fromDue && due > today ? due : today;
  const next = new RRule({ ...RRule.parseString(rule), dtstart: toUtc(anchor) }).after(toUtc(after), false);
  return next ? toDate(next) : null;
}
```
(Use whatever small type narrowing TypeScript needs for `due`; behaviour must not change.)

**Step 5:** `npm test -w @claudia/worker && npm run typecheck`. Expected: pass.

**Step 6: Commit:** `git add worker package-lock.json && git commit -m "Add the recurrence date calculation"`.

### Task 2: Advance on completion, validate rules

**Files:**
- Modify: `worker/src/routes/tasks.ts` (`checkRecurrence`, create and update, `setCompleted`, the complete route description)
- Modify: `worker/src/lib/recurrence.ts` (add `userTimeZone(db)`) or a small helper next to it
- Test: `worker/test/recurrence-api.test.ts`

**Behaviour** (write the failing tests first; follow the helpers and style in `worker/test/tasks.test.ts`: `client`, `makeToken`, `reset`, a list for the task):

1. **Validation.** `POST /api/tasks` and `PATCH /api/tasks/{id}` with a `recurRule` that fails `isValidRule` return 422 `invalid_recurrence`. Extend `checkRecurrence` (it already checks the pair) rather than adding a second check. Valid rules still work. A PATCH that does not touch recurrence on a task whose stored rule is somehow invalid must not start failing: only validate when the request sets `recurRule`.
2. **Time zone.** Add `userTimeZone(db)`: read the `settings` row with key `timeZone`; if its value is a non-empty string use it, else `DEFAULT_TIME_ZONE`. `settings` is a key/value table with JSON values (see `worker/src/routes/settings.ts`).
3. **Advancing.** In `setCompleted`, when `done` is true, the task is open (`completedAt` null), `kind` is `task`, `recurRule` is set and `dueAt` is null: compute `next = nextDueDate(recurRule, recurFrom, dueDate, todayIn(tz))`. If `next` is not null, do not set `completedAt`. Instead update `dueDate = next`; if `startDate` is set, shift it by `daysBetween(oldDue, next)` days using `addDays` (only when there was an old due date; otherwise leave it); set `snoozedUntil = null`; set `updatedAt`. Write a `completed` event in the same batch with `before` and `after` each holding `{ dueDate, startDate, snoozedUntil }`. Return the updated task. If `next` is null, or the task has `dueAt`, fall through to the existing normal completion.
4. `uncomplete` on an open recurring task stays a no-op (the existing early return handles it; add a test).
5. Update the route description to: "Completing a task that repeats advances it to its next due date and keeps it open; completing it twice advances it twice. Other tasks: idempotent." Update the MCP `complete_task` description in `worker/src/mcp/tools.ts` similarly (short: "Mark a task as done. A repeating task moves to its next due date and stays open. Safe to repeat for other tasks."), and fix any MCP test that asserts the old text.

**Test cases** (compute dates relative to today with the same helpers, e.g. `const today = todayIn("Australia/Sydney")`, so no fake clock is needed):
- weekly from due, due 10 days ago: after completing, `completedAt` is null, `dueDate` is the first matching weekday after today, and it is within the next 7 days. (Use `FREQ=WEEKLY` with a due date whose weekday you know from the helper; assert `dueDate > today` and `daysBetween(today, dueDate) <= 7` and the weekday matches the old due date's weekday.)
- from completion, `FREQ=DAILY;INTERVAL=2`: next is today + 2 days.
- no due date, `FREQ=WEEKLY` from `completion`: gains a due date of today + 7.
- start date shifts by the same delta as the due date; snooze cleared; title, notes, labels and `position` unchanged.
- the `events` table gets exactly one extra `completed` event with the old and new `dueDate` in `before`/`after` and the right actor.
- a rule with `COUNT=1` completes normally (`completedAt` set).
- a task with `dueAt` set completes normally.
- a non-recurring task is unchanged (existing tests still pass).
- invalid rules: 422 on create and on patch; valid on patch.

**Verify:** `npm test` (whole repo), `npm run typecheck`, `npm run build`. Expected: all pass.

**Commit:** `git add worker && git commit -m "Advance recurring tasks on completion"`.

### Task 3: Docs and wrap-up

**Files:**
- Modify: `CLAUDE.md` (Platform line: "Cron Triggers handle nightly backups to R2." — recurrence no longer runs on cron), `README.md` (same sentence)
- Modify: `docs/plans/2026-10-26-recurrence-design.md` (status: built)

**Steps:** make the three edits, run `npm test`, commit "Document recurrence on completion". Then (controller, not the subagent): add a dated `#Decision` to the Obsidian note and fix its stale "cron: recurrence" mentions (architecture diagram line and any "Cron Triggers handle recurrence" text), move the board card to DONE after Andrew has pushed and checked it on production by completing a recurring task, and add the `due_at` recurrence follow-up to BACKLOG.
