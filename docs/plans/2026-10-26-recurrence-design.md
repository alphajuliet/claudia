# Recurrence: design

Date: 2026-10-26. Status: built.

Completing a recurring task advances it in place to its next due date instead of closing it. The columns (`recur_rule`, `recur_from`) and the API fields already exist; what is missing is the engine.

## What the data needs

A read-only look at production (2026-10-26) found 27 open recurring tasks, all with date-only due dates (no `due_at`). Rules are simple: `FREQ` of YEARLY, MONTHLY, WEEKLY or DAILY, with `INTERVAL` and `BYDAY`. One MONTHLY "from completion" task has no due date.

## Next date

A pure function, `nextDueDate(rule, from, due, today)`, built on the `rrule` library. All dates are `YYYY-MM-DD` and the arithmetic is done in UTC, so there are no time-zone or daylight-saving effects.

- "Today" is the current date in the user's `timeZone` setting (default `Australia/Sydney`).
- Repeat from `due`: the rule starts at the old due date, which keeps `INTERVAL` and `BYDAY` aligned. The next date is the first occurrence strictly after the later of the old due date and today. Completing late skips the missed occurrences; completing early moves past the current due date.
- Repeat from `completion`: the rule starts today, and the next date is the first occurrence strictly after today.
- No due date: behaves as "from completion", so the task gains a due date.
- A rule that has run out (`COUNT` or `UNTIL`) returns null, and the task completes normally.
- Only YEARLY, MONTHLY, WEEKLY and DAILY are accepted, so no rule can make the calculation slow.
- Known limit: a MONTHLY rule on the 29th to 31st skips months that lack the day (the library's behaviour).

## Completing a recurring task

- The task stays open. `due_date` moves to the next date; `start_date`, if set, shifts by the same number of days; `snoozed_until` is cleared. Notes, labels, subtasks, ID and position are untouched.
- A `completed` event is logged, with the old and new `due_date`, `start_date` and `snoozed_until` in `before` and `after`, so a history screen can offer undo later.
- The response is the updated (still open) task.
- `uncomplete` on a recurring task is a no-op, because it never closed. To fix a mistake, edit the due date.
- Completing twice advances twice (not idempotent, unlike a plain task).
- A recurring task with a timed `due_at` is completed normally for now (not advanced).
- Headings never recur.

## Validation

Creating or updating a task with a `recurRule` that does not parse, has no `FREQ`, or uses a frequency finer than DAILY returns 422 `invalid_recurrence`.

## No cron

Completion does all the work, so no scheduled job is needed. The earlier note said Cron Triggers handle recurrence; that is superseded. Cron remains for nightly backups.

## Testing

Unit tests for `nextDueDate` (late, early and on-time completion; fortnightly phase; `BYDAY` lists; from completion; no due date; exhausted rule; every distinct rule found in production). API tests for completion, the event, `uncomplete`, and validation. Tests compute dates relative to the real current date using the same helper, so no fake clock is needed.
