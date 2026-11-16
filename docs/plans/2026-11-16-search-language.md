# Search language in the Search view: implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Search view takes the structured search language from `2026-11-16-search-language-design.md`, with Sort and Group menus, errors under the field, and a cheat sheet.

**Architecture:**
- liqe parses the query. `worker/src/domain/search.ts` lifts `sort:` and `group:` from the top level, checks the tree and compiles it to a Drizzle condition, served at `GET /api/search`.
- The sort and group strings (`due-desc`, `label:wip,next`) are parsed by shared code, so the URL, the server and the web app agree.
- The web app arranges the rows into groups in `web/src/lib/search.ts`, as the views already do on the client, because list order is the sidebar's.

**Tech stack:** liqe 3.8, Hono + zod-openapi, Drizzle over D1, React + TanStack Query, Vitest.

**Scope:** the Search view only. These come later, each as its own step:
- `sort`, `group` and `display` columns on saved filters, and Save as filter.
- MCP `search_tasks` taking the language.
- The built-in views expressed as queries.

---

### Task 1: Sort and group specs in shared

**Files:** create `shared/src/search.ts` and `shared/src/search.test.ts`; export from `shared/src/index.ts`; add `SearchQuerySchema` and `SearchResultSchema` to `shared/src/schemas.ts`.

- `SEARCH_SORTS = ["list", "priority", "due", "start", "created", "updated", "title"]`. `parseSort("due-desc")` returns `{ by: "due", desc: true }`, and null for an unknown value. `formatSort` does the reverse.
- `parseGroup` handles `"list" | "due" | "none" | "label" | "label:a,b"` and returns `{ by, labels? }`. `formatGroup` does the reverse.
- `SearchQuerySchema`: `q` (default ""), `context`, `status` (`open | completed | all`, optional), `sort`, `group`, `limit` (≤500, default 500), `offset`.
- `SearchResultSchema`: `{ tasks, sort, group }`.

Test: the round trip, unknown values, and `-desc`. Run `npm test -w @claudia/shared`.

### Task 2: The engine

**Files:** create `worker/src/domain/search.ts`. Test it in `worker/test/search.test.ts`.

1. Write failing API tests (Task 3 adds the route) covering:
   - each field, `#label` and bare words;
   - `AND`/`OR`/`NOT` and implicit AND;
   - dates (`today`, `7d`, `today-7d`, ISO dates, ranges, a due time by its Sydney day);
   - `is:` and `has:`;
   - `list:` and `folder:` (emoji, wildcards, subfolders);
   - the defaults (open, no headings, not snoozed, and the context switch unless `context:` or `folder:`);
   - `sort:` and `group:` lifted, or rejected when nested;
   - errors with their column.
2. Implement the engine:
   - `resolveDate(word, today)`: returns `YYYY-MM-DD` or null.
   - `parseSearch(q)`: returns `{ ast, sort, group }`, or throws `ApiError(422, "invalid_query", …, [{ column }])`.
   - `searchTasks(db, query)`: returns `{ tasks, sort, group }`.
3. How the compile step works:
   - Each Tag becomes a condition.
   - `NOT` becomes `NOT coalesce(cond, 0)`, so a missing date counts as false and the `NOT` then makes it true.
   - Lists and folders are resolved in JS against the live rows, then matched with `inArray`.
   - The defaults are added unless the tree mentions them.
   - The SQL order follows the sort key with nulls last (for API callers): `coalesce(due_date, due_at)` for due, then priority, list and position.

### Task 3: Route

**Files:** create `worker/src/routes/search.ts` and register it in `worker/src/index.ts`. It's a read route, `GET /api/search`.

Run `npm test -w @claudia/worker -- search`.

### Task 4: Web sections

**Files:** create `web/src/lib/search.ts` and `web/src/lib/search.test.ts`.

`searchSections(tasks, { sort, group }, { lists, listOrder, today, timeZone })` returns `{ key, title, rows }[]`:

- **`list`:** sidebar order. With the default sort, each group is in outline order with priority first (`groupByList`); otherwise it's flat rows in the sort order.
- **`due`:** `groupByDue`, re-sorted within each bucket when a sort is given.
- **`label`:** each task goes once, in its first label by the given order, then alphabetical order. "No label" comes last.
- **`none`:** one untitled section.

The sort comparator puts nulls last and breaks ties by priority, list order and position. Due goes by `dueDateOf`, then `dueAt`.

### Task 5: Search screen

**Files:** modify `web/src/ui/SearchScreen.tsx` and `web/src/data/queries.ts` (`useSearch`); extend the web tests.

- `useSearch(params)` caches under `["tasks", "search", …]`, so task changes refresh it.
- The address holds `q`, `sort` and `group`. The menus set `sort` and `group`; "Default" clears them. The menus show the sort and group the server reports.
- Show completed adds a second query with `status=completed`.
- A query error shows under the field (`role="alert"`) and keeps the last results.
- A **?** button toggles a cheat sheet.
- Rows say which list they're in, except when grouped by list.

### Task 6: Docs and finish

- Update `docs/architecture.md` (the Search route and the engine) and the design doc's status.
- Add a `#Decision` to the Obsidian note.
- Run `npm run typecheck`, `npm test` and `npm run build`, then commit.
