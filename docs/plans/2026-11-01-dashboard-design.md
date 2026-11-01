# Dashboard design

Status: approved.

The Dashboard is the daily start: what needs Andrew today, as real tasks he can act on. It mirrors the daily review in the task management note (top 3, overdue, due this week, waiting items) and shows the WIP limit of 3. It is not a statistics screen, and needs no API change.

## Layout

Two columns on desktop, one below 900px.

```
Sunday 1 November                      [All|Work|Personal|Home]
3 WIP · 2 Overdue · 4 Today · 6 Inbox

WIP 3/3                          │ This week          5 more ▸
 ☐ Draft the Q4 plan        Acme │  ☐ Submit expenses  Tue  Acme
 ☐ Fix the back gate        Home │  ☐ Pay water bill   Wed  Home
 ☐ Book flights  Thu    Personal │
                                 │ Waiting (oldest first)
Overdue and today                │  ☐ Sam - contract  12d  Acme
 ☐ Renew rego  2d ago       Home │  ☐ Jo - quote       5d  Home
 ☐ Call Sam    4 pm         Acme │
 ☐ Weed the beds  Today     Home │
```

On a phone the order is WIP, Overdue and today, This week, Waiting.

## Behaviour

- **Rows** are the normal task rows: ticking, renaming, swiping and opening the panel all work. Each also shows its list name. Dragging to reorder is off, as on the other views.
- **No duplicates:** a task appears once, in the first section it fits, in the order above.
- **WIP limit:** the heading shows count over 3. Over the limit it turns red, and nothing is enforced.
- **Long sections:** WIP shows everything. The others show 5 and an "N more" link: Overdue and today opens Today, Waiting opens Waiting, and This week expands in place because it has no view.
- **Summary line:** each number links to its view; Overdue links to Today. Inbox is not a section, because triage happens there.
- **Context:** it follows the All, Work, Personal and Home filter.

## Navigation

Dashboard is the first sidebar item, at `/dashboard`, and `/` opens it instead of Inbox. `g d` goes there, as a registered command. Quick add on the Dashboard goes to the Inbox.

## Data

The screen reuses the `/api/tasks` queries behind the WIP, Today and Waiting views, and adds one for the next 7 days. A pure function sorts the results into sections and removes duplicates.

Waiting age counts from the task's creation, because nothing records when the `waitingOn` label was added. A task created long ago and only just marked as waiting looks old.

## Edge cases

An empty section shows one quiet line, such as "Nothing overdue". A section that fails to load shows an error, and the others still work.

## Testing

Unit tests for sorting into sections and removing duplicates. Screen tests with the fake API. Playwright screenshots at desktop and phone width, light and dark.
