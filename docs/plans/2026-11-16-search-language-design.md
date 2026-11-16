# Search language

Date: 2026-11-16. Status: approved. The engine, `GET /api/search` and the Search view are built; saved filters' sort, group and display, Save as filter, MCP `search_tasks` and the views as queries are still to do.

Board card (WIP): "Design a framework and syntax for semantic search in Search view. Use an existing library if possible." It also covers the backlog card "Semantic search" (boolean expressions over structured data, `#label`, sorting and grouping) and answers the note's open question on a richer filter language for smart lists.

"Semantic" here means a structured query language over the task fields, not embedding search.

## Decisions

- **Syntax:** Lucene-style, parsed by [liqe](https://github.com/gajus/liqe) (BSD-3-Clause; depends on `nearley`). It is a standard syntax and flexible enough for complicated queries: `field:value`, `AND`, `OR`, `NOT`, `-term`, parentheses, quoted phrases, and a space meaning AND. Comparisons (`due:<=today`) and ranges (`due:["today" TO "7d"]`) parse with their values as plain text, which we interpret.
- **liqe only parses.** We compile its parse tree to Drizzle SQL on the server. liqe's in-memory filtering isn't used.
- **The split:** the query string chooses which tasks. Sort and group are separate settings. The search box accepts `sort:` and `group:` as shortcuts, taken from the top level of the query only (inside `OR` or parentheses they are an error), in the way GitHub search treats `sort:`. Output format is never in the query.
- **No Godspeed port.** Andrew will write new queries rather than converting the old smart lists. liqe has no `&` or `|`.

## Vocabulary

Bare words and quoted phrases (`report`, `"weekly report"`) match the title or notes, ignoring case.

| Field | Values | Notes |
|---|---|---|
| `label:` | name | `#next` is shorthand for `label:next`. Case-insensitive |
| `list:`, `folder:` | name, `*` wildcard | `folder:` includes subfolders. A leading emoji is ignored (`list:Renovations` finds "🛠️ Renovations") |
| `context:` | `work`, `personal`, `home` | |
| `priority:` | `low`, `normal`, `high` | Ordered, so `priority:>=normal` works |
| `due:`, `start:`, `snoozed:`, `completed:`, `created:`, `updated:` | a date | `:` means on that day; also `:<`, `:<=`, `:>`, `:>=` and ranges |
| `is:` | `open`, `completed`, `snoozed`, `available`, `recurring`, `heading`, `subtask` | `available`: open, not snoozed, and not starting after today |
| `has:` | `due`, `start`, `notes`, `labels`, `parent` | `-has:due`: no due date |

**Dates:** `today`, `tomorrow`, `yesterday`, `7d`, `2w` or `3m` (from today), `today-7d` (past; an unquoted `-7d` is a liqe syntax error), or `2026-11-20`. They resolve in the user's time zone when the query runs, so a saved filter stays relative. Due conditions match a due date, or a due time by its day, as `dueBy` does now.

**Defaults:**

- Unsnoozed tasks only, unless the query has `is:snoozed` or a `snoozed:` condition (as Search did before).
- Open tasks only, unless the query has `is:completed` or a `completed:` condition. Show completed works as it does now.
- No headings, unless the query has `is:heading`.
- The sidebar's context switch narrows the results, unless the query names `context:` or `folder:`.

**Sort:** `sort:` takes `due`, `start`, `priority`, `created`, `updated`, `title` or `list`, with an optional `-desc` (`sort:due-desc`; `sort:-due` is a liqe syntax error). The default is priority, then sidebar list order and position, as views use now.

**Group:** `group:` takes `list` (the default), `due` (the buckets views use: Overdue, Today, Tomorrow, This week, This month, Later, No date), `label` or `none`. A label order is quoted: `group:"label:event,wip,next"`.

**Errors:** a query that doesn't parse, an unknown field, or an unknown `is:`, `has:`, sort or group value is a 422 `invalid_query` with `{ message, column }`. Nothing is silently ignored.

Example:

```
folder:Work (#wip OR due:<=today OR start:<=today) sort:due group:"label:event,wip,next,waitingOn"
```

## Engine

`worker/src/domain/search.ts`, in three steps:

1. **Parse:** liqe gives the tree, and we lift `sort:` and `group:` out of the top-level AND.
2. **Check:** fields, values and dates are validated against the vocabulary.
3. **Compile:** the tree becomes a Drizzle `SQL` condition, reusing `dueBy`, `hasLabel`, `notSnoozed`, `openTask` and `listsInContext`. It runs through `fetchTasks` with the resolved sort.

The built-in views stay in `views.ts`. Each is expressed as a query (Next is `#next is:available`), so a view and the same typed search can't disagree.

## API

- `GET /api/search?q=&context=&status=&sort=&group=&limit=&offset=` returns `{ tasks, sort, group }`: the matching tasks and the sort and group in effect. Parameters win over `sort:` and `group:` written in `q`.
- `GET /api/tasks` keeps its parameters for simple programmatic use (a list's contents, the importer). Its `q` stays a plain text match.

## Saved filters

- `filters` gains nullable `sort`, `group` and `display` columns (null means the default). `display` is JSON for output format: compact or detailed rows, which fields show (due, list, labels, notes preview), and whether completed tasks show by default.
- `query` is a search-language string, validated on create and update. Saving moves any top-level `sort:` and `group:` into the columns, so the stored query is filter only.
- `GET /api/filters/{id}/tasks` runs through the same engine. Production has no saved filters, so no data migration is needed.

## MCP

- `search_tasks` takes `query` in the language. Its description gives the vocabulary and three or four examples. Check by hand that Claude writes valid queries from it.
- `run_filter` is unchanged. `create_filter` and `update_filter` take `query`, `sort`, `group` and `display`.
- Task results keep their shape. List and folder names are their own backlog card.

## Web app

- **Search screen:** takes the language, still debounced, with the query in the address (`?q=`).
  - Errors show under the field.
  - A **?** opens a cheat sheet.
  - Sort and Group menus sit beside Show completed and update the address.
  - **Save as filter** asks for a name.
- **A saved filter's screen:** the same screen with the query, sort, group and display filled in. Changes save back to the filter.

## Testing

- **Unit tests for the engine:**
  - Each field and `is:` / `has:` value.
  - Date words and offsets around midnight in Sydney.
  - Precedence of `AND`, `OR` and `NOT`.
  - `sort:` and `group:` lifted from the top level and rejected elsewhere.
  - Error columns.
- **API tests against a local D1:** `/api/search` with a set of representative queries, saved filters with sort and group, and the views matching their query form.
- **Web tests:** the Search screen's errors, menus and Save as filter.

## Not in scope

- Filters in folders, and editing or deleting them from the sidebar (the "Smart views" card).
- Autocomplete in the search box.
- Display options beyond those above.
- A `duration:` field (the duration-tag card).
