# Quick dates and due times

Date: 2026-11-01. Status: approved.

Board card: "Quick dates and due times" (#Desktop #Mobile). Today the detail panel has plain date inputs for Due and Start, a due time (`dueAt`) can only be shown, quick add knows only `#labels`, and nothing sets a snooze. This card adds one-tap dates, due times and snoozing in the panel, and dates typed at the end of quick add.

## Date picker component

One component in the detail panel, used for Due and for Snooze.

- Quick buttons: **Today**, **Tomorrow**, **This weekend** (the coming Saturday; on a Saturday or Sunday, today), **Next week** (the coming Monday). Snooze replaces Today with **This evening** (6 pm today; hidden after 6 pm).
- A native date input for any other day, so iOS and iPad show their own picker.
- An optional native time input.
  - A date alone saves `dueDate` and clears `dueAt`.
  - A date with a time saves `dueAt` (UTC, worked out in the user's time zone) and clears `dueDate`.
  - Clearing the time keeps the day as a date only.
- Clear.
- It shows a relative label in the same form as the rows ("Tomorrow", "Fri, 3:00 pm", "3 Nov"), and overdue in red.

### Due

- Writes `dueDate` or `dueAt`, never both.
- On a repeating task the time input is disabled with the note "Times on repeating tasks are coming". Recurrence ignores `dueAt` today, so a time would make the next completion final. The BACKLOG card "Advance recurring tasks that have a due time" lifts this.

### Snooze

- Writes `snoozedUntil`. A date without a time means the start of that day in the user's time zone. Choices that would snooze into the past (This weekend on a weekend) are left out.
- A snooze that has passed shows as none.
- Views already hide snoozed tasks, so snoozing takes the task off screen. The panel closes and a toast says "Snoozed until Sat" with Undo, which restores the previous `snoozedUntil`.
- A snoozed task opened from search shows its snooze with Clear.

### Start

- Start leaves the panel; it is informational and nothing uses it. It stays in the API and MCP.
- A task that already has a start date shows it read-only with Clear.

## Dates in quick add

A parser in `web/src/lib/when.ts`, hand-written (the vocabulary is small and fully testable; no library).

- `#labels` are taken out first. The parser then reads words backwards from the end for as long as they still form a date, a time, or both. Only that tail counts: "Book Friday dinner" stays text; "Call Sam fri 3pm" is due Friday at 3 pm.
- Dates: `today`/`tod`, `tomorrow`/`tmr`, weekday names short or long (`fri`, `friday`; today counts, as in Todoist; `next fri` is a week after that), `weekend`, `next week`, `in N days`/`in N weeks`, `3 Nov`, `Nov 3`, `3/11` (day first), each with an optional year. A date without a year that has passed this year means next year.
- Times: `3pm`, `3:30pm`, `3.30pm`, `15:00`, `noon`, `midnight`, optionally after `at`. A time alone means today, or tomorrow if it has passed.
- A preview chip under the field shows what will be set ("Due Fri, 3:00 pm"). Its × keeps the words as part of the title for this entry.
- A parsed date replaces Today's "due today" default. A tail that is the whole text is the title, as with labels ("Tomorrow" alone is a task called "Tomorrow").
- Quick add does not snooze.

## Testing

- Unit tests for the parser and for the date arithmetic (weekend, next week, start of day to UTC), with a fixed now and time zone, including the Sydney daylight-saving changes (4 October 2026 and 5 April 2026).
- Component tests: the quick buttons, adding and clearing a time (dueDate and dueAt swap), the disabled time on a repeating task, snooze with Undo, a read-only Start, and the quick-add preview and its ×.

## Not in scope

Keyboard date shortcuts, snooze words in quick add, recurrence with due times (BACKLOG card), and timed notifications (out of scope for day one).
