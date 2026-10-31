# Drag reorder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorder tasks on list screens by dragging with the mouse (between rows, into a task, past headings, a heading with its section, onto a sidebar list) and with Alt+↑/Alt+↓ (design: `2026-11-01-drag-reorder-design.md`).

**Architecture:**
- **Server:** `withSection` on the move endpoint moves a heading and its section atomically.
- **Drop rules:** pure functions in `web/src/lib/reorder.ts` turn a drop (or an Alt+arrow) into a `TaskMove` request. They work over the rows as shown, flattened into display items.
- **Optimistic move:** `useMoveTask` places the task in the cache at once with `fractional-indexing`, and rolls back on failure.
- **Dragging:** a `useDrag` hook in `web/src/ui/useDrag.ts` handles mouse pointer events on the list. It finds targets from row rectangles and draws a ghost and an indicator.
- **Sidebar:** the sidebar's list links accept drops, found with `elementFromPoint` and a `data-drop-list` attribute.

**Tech Stack:** Hono + Drizzle on D1 (worker tests via `@cloudflare/vitest-plugin`), React, TanStack Query, Vitest + Testing Library, hand-written CSS.

**Commands:**
- Run `npm test -w @claudia/worker`, `npm test -w @claudia/web`, `npm run typecheck` and `npm run build` from the repo root.
- Work on the branch `drag-reorder`.

**Conventions:**
- Australian English.
- Short doc comments, in the style of the surrounding code.
- Tests first.
- Small imperative commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Domain facts you need:**
- A heading is a task with `kind: "heading"`. It is always top level (`parentId: null`) and never has subtasks.
- A heading's section is not stored. It is the top-level tasks that follow the heading by position, down to the next heading.
- Subtasks have `parentId`, and positions are per sibling group (same list and parent).
- `ListScreen` (`web/src/ui/screens.tsx`) builds `Section[]` from `listSections(visibleRows(tasks))`:
  - The first section, `key: "top"`, has no heading.
  - Each heading starts a new section with `heading` set and `rows` holding its tasks and their subtasks, with `depth`.
- `TaskList` (`web/src/ui/TaskList.tsx`) renders the sections. A collapsed heading hides its rows, and a collapsed task hides its subtasks.
- Snoozed tasks, and completed ones unless "Show completed" is on, are not on screen but still have positions.

---

### Task 1: `withSection` on the move endpoint

**Files:**
- Modify `shared/src/schemas.ts` (`TaskMoveSchema`), `worker/src/routes/tasks.ts` (the move route) and `worker/src/mcp/tools.ts` (the `move_task` description and input).
- Test in `worker/test/tasks.test.ts`, and in `worker/test/mcp-tools.test.ts` if tools are listed or snapshotted there.

**Behaviour:**
- Add `withSection: z.boolean().optional()` to `TaskMoveSchema`, described as: "For a heading: move the tasks under it (down to the next heading) with it".
- With `withSection: true`:
  - **Validation:**
    - The task must be a heading; otherwise 422 `invalid_section`.
    - `parentId` must be null or absent; otherwise 422 `invalid_parent`.
  - **The section:** the live (not deleted) top-level tasks of the heading's list positioned after the heading, up to but not including the next heading. Include completed and snoozed tasks.
  - **Placement inside the section:** `afterId` or `beforeId` naming a section task is 422 `invalid_placement`, "A heading can't be placed inside its own section".
  - **Placing the heading:**
    - Compute its new position with `positionFor` over the target scope, excluding the heading and its section tasks from the neighbours.
    - The simplest way: when the placement resolves against a neighbour that is in the section, look past it. A helper that takes an exclusion set is fine.
  - **Placing the section:**
    - Give the section tasks positions straight after the heading's new position, before the next sibling in the target scope (excluding the moved items).
    - Use `generateNKeysBetween(headingPos, nextPos, n)` from `fractional-indexing`, keeping their order.
  - **Another list:**
    - If `listId` differs, every section task and all their subtasks get the new `listId`, as the existing subtree code does for a task.
    - Write a `moved` event for each section task, and `{listId}` events for their subtasks, as the existing code does.
  - Everything goes in one `runBatch`.
- Without `withSection` behaviour is unchanged.

**Tests (write first):**
1. List: H1, a, b, H2, c, plus a completed task between a and b. Move H1 with `withSection` and no placement (to the end). The order is H2, c, H1, a, (completed), b.
2. Move H2 with `withSection` and `beforeId: H1`. The order is H2, c, H1, a, …, b.
3. With `listId` set to another list, the heading, a, b and a's subtask all move, and the old list keeps H2 and c in order.
4. `afterId: a` with `withSection` on H1 gives 422 `invalid_placement`.
5. `withSection` on a task gives 422.
6. MCP: `move_task` accepts `withSection` (follow the existing MCP tool test patterns).

**Commit:** `Move a heading with its section in one step`.

---

### Task 2: Drop rules (`web/src/lib/reorder.ts`)

Pure functions, unit-tested in `web/src/lib/reorder.test.ts`. No React.

```ts
import type { Task } from "@claudia/shared";
import type { Section } from "../ui/TaskList"; // or move the Section type to lib/tasks.ts if importing from ui is awkward

/** The rows as shown, in order: headings and task rows with their depth. Collapsed parts are not in it. */
export type Item = { kind: "heading"; task: Task } | { kind: "row"; task: Task; depth: number };
export function displayItems(sections: { heading?: Task; rows: { task: Task; depth: number }[] }[]): Item[];

/** A request for POST /api/tasks/{id}/move (id separate). */
export interface MoveRequest { parentId: string | null; beforeId?: string; listId?: string; withSection?: true }

/** Where a drop lands. */
export type Drop =
  | { kind: "gap"; index: number; depth: number }  // before items[index] (index === items.length: the end)
  | { kind: "into"; taskId: string };               // last subtask of this task

/** The items left once the dragged task and everything under it (its subtasks, or a heading's section) are taken out. */
export function withoutDragged(items: Item[], dragged: Task): Item[];

/** The depths a drop at gap `index` may take (in `items` without the dragged ones): an inclusive range. */
export function gapDepths(items: Item[], index: number): { min: number; max: number };

/** The gaps a heading may land in: before a heading, or the end, but never above the first heading when task rows come before it. */
export function headingGaps(items: Item[]): number[];

/** The move request for a drop, or null when it lands where the task already is. `items` excludes the dragged ones. */
export function moveFor(items: Item[], dragged: Task, drop: Drop, original: Item[]): MoveRequest | null;

/** Alt+↑ / Alt+↓: the move request for the highlighted task, or null when it can't move that way. */
export function stepMove(items: Item[], task: Task, direction: -1 | 1): MoveRequest | null;

/** Where a task is now, as a move request: for Undo after a move to another list. */
export function placeOf(items: Item[], task: Task): MoveRequest;
```

**Rules:**
- **`gapDepths(items, i)`:** let `above = items[i-1]` and `below = items[i]`.
  - `max` is `above.depth` if `above` is a row, else 0.
  - `min` is `below.depth` if `below` is a row, else 0.
  - If `min > max`, use `{min: max, max}`. That can't happen in a valid outline, but be safe.
  - A heading above or below means the top level only, unless the row below is deeper. Next to a heading only depth 0 is possible.
- **`moveFor` for a gap at depth D:**
  - **The parent:**
    - When D = 0, the parent is null.
    - Otherwise it is the nearest item above the gap with depth D−1. It must be a row.
  - **The placement:** `beforeId` is the next item after the gap at depth D under the same parent.
    - Scan forward and stop at the first item with depth < D, or at a heading when D = 0. A heading also counts as a depth-0 sibling, so at depth 0 the next top-level item, heading or row, is the `beforeId`.
    - If there is none, leave `beforeId` out, so the task goes at the end of that parent's children (or of the list).
  - **The no-op check:** compare against the dragged task's original parent and original next sibling, worked out with `placeOf` on the original items. If both are the same, return null.
- **`moveFor` for `into`:** `{ parentId: taskId }`, with no placement, so it goes at the end of the children. It returns null if the task is already a child of `taskId` and already its last visible child.
- **Headings:**
  - `moveFor` with a heading as `dragged` accepts only gaps from `headingGaps`. It returns `{ parentId: null, beforeId: <heading at items[index]>, withSection: true }`, or `{ parentId: null, withSection: true }` at the end.
  - For any other gap it returns null.
  - It also returns null when the heading would land where it is.
- **`stepMove(items, task, dir)`** works on the full items, including the task.
  - **A subtask (depth > 0):** its siblings are the items at the same depth under the same parent.
    - Up: `beforeId` is the previous sibling.
    - Down: `beforeId` is the sibling after the next sibling, or none (the end) if the next one is the last.
    - At either end it returns null.
    - The parent stays the same: `parentId` is the task's own.
  - **A top-level task:** look at the previous or next top-level item (depth 0 or a heading).
    - Up past a row R: `beforeId: R`.
    - Up past a heading H: it moves to the end of the section above, so `beforeId: H`. The task now sits before H, in the previous section.
    - Down past a row R: `beforeId` is the top-level item after R, or none.
    - Down past a heading H: it goes first in H's section, so `beforeId` is the first top-level item after H, or none if H's section is empty and nothing follows.
    - Returns null at the ends.
  - **A heading (`withSection: true`):**
    - Up: the previous heading Hp gives `beforeId: Hp`. With no previous heading it returns null, since it never goes above the first heading's leading rows.
    - Down: the next heading Hn gives `beforeId` of the heading after Hn, or none (the end). With no next heading it returns null.
- **`placeOf(items, task)`:** `{ parentId: task.parentId, beforeId: next sibling }`, with the sibling found as in `moveFor`.

**Tests:** cover each rule with small outlines built with `task()` from `web/src/ui/testApi.tsx` (or a local factory):
- gap depths next to rows and headings;
- a gap at depth 0, 1 and 2;
- the end of the list;
- dropping into a task;
- no-ops;
- the heading gaps and requests;
- every `stepMove` case, including the ends.

**Commit:** `Work out where a dragged or stepped task lands`.

---

### Task 3: Optimistic moves and Alt+↑ / Alt+↓

**Files:**
- Modify `web/src/data/queries.ts` (`useMoveTask`), `web/src/lib/commands.ts`, `web/src/lib/keymap.ts`, `web/src/ui/keyboard.tsx`, `web/src/ui/TaskList.tsx` and `web/src/ui/screens.tsx`.
- Add `fractional-indexing` to `web/package.json`. The worker already uses it.
- Test in `web/src/lib/keymap.test.ts` and a new `web/src/ui/reorder.test.tsx`.
- Extend the fake API in `web/src/ui/testApi.tsx` so `POST /api/tasks/{id}/move` really reorders: compute a position with `generateKeyBetween` and apply `listId`, `parentId` and `withSection`. Check what it does today first.

**Behaviour:**
- **`TaskMove` type:** gains `withSection?: boolean`. It comes from the shared schema once Task 1 is in.
- **`useMoveTask` `onMutate`:**
  - Cancel task queries.
  - In every cached task list (not the `["tasks","one",id]` entries; use `changeCached` as other mutations do), give the task its new `parentId`, `listId` and a `position` between its new neighbours among the cached siblings, using `generateKeyBetween`.
  - If the target list differs from the cached list's `listId` query, remove the task and its subtree from that cache.
  - With `withSection`, move the section's cached tasks right after the heading, with `generateNKeysBetween`.
  - Keep the returned `changed` for `onError` to restore, as `useDeleteTask` does.
  - Keep `onSuccess` and `onSettled` as they are.
- **The keymap:**
  - Bindings may carry a modifier, written `"Alt+ArrowUp"`.
  - In `keyboard.tsx`, build the key string as `Alt+${e.key}` when only `altKey` is held.
  - `ignoresKeys` still ignores Ctrl or ⌘, and still ignores typing in text fields. It lets Alt through only when the resulting key string has a binding; the simplest way is a check like `e.altKey && !ALT_KEYS.has(e.key)`.
- **Commands:**
  - `{ id: "moveUp", label: "Move task up", keys: ["Alt+ArrowUp"] }` and `{ id: "moveDown", label: "Move task down", keys: ["Alt+ArrowDown"] }`, placed after `previous`.
  - The shortcuts overlay should show them readably, e.g. "⌥↑". Check how `Shortcuts.tsx` renders keys and add a mapping.
- **Wiring:**
  - `TaskList` takes an optional `reorder?: { listId: string }` prop. Only `ListScreen` passes it.
  - When it's set, `moveUp` and `moveDown` work out `stepMove(displayItems(shownSections), current, dir)`.
  - On a request, call `move.mutateAsync({ id, ...request })`. On failure show the error in the toast.
  - Keep the highlight on the task. Its row remounts in a new place, so re-focus it after the cache update with `focusTask(id)`, in a `requestAnimationFrame` or an effect.
  - With no `reorder`, or no current task, return false.

**Tests (component, `web/src/ui/reorder.test.tsx`):**
1. A list with a, b, c: highlight b with `j`, press Alt+↑, and the rows read b, a, c. The POST body is `{ parentId: null, beforeId: a.id }`, and b is still highlighted and focused.
2. Alt+↓ on the last task does nothing and sends nothing.
3. A top-level task first under heading H, moved up, ends in the section above. Check the rendered sections.
4. A heading moved down past the next section sends `withSection: true`, and the sections render swapped.
5. A failed move (gate rejection or `failMove`) puts the order back and shows the error.
6. On a view (`/next`), Alt+↑ does nothing.
7. Keymap unit test: Alt+ArrowUp matches `moveUp`; Alt+j still matches nothing; typing in a text field with Alt still ignores keys.

**Commit:** `Move the highlighted task with Alt+↑ and Alt+↓`.

---

### Task 4: Dragging in the list

**Files:**
- Create `web/src/ui/useDrag.ts`.
- Modify `web/src/ui/TaskList.tsx`, `web/src/ui/TaskRow.tsx` and `web/src/styles.css`.
- Test in `web/src/ui/drag.test.tsx`.

**Behaviour:**
- **When it runs:**
  - Only with `reorder` set (list screens), and only for `pointerType === "mouse"` and the primary button.
  - Touch keeps the swipes.
  - It ignores presses on `.task-check`, `.disclosure`, inputs, textareas, selects and links, and while any row is renaming (an input inside the row).
- **Starting:**
  - `pointerdown` on a row (`li.task-row`) or a heading button (`.section-title-button`) records the start.
  - Moving past 5px starts the drag. Take pointer capture on `document.body` or use window listeners; window `pointermove` and `pointerup` listeners added at `pointerdown` and removed on finish are simplest.
  - When a drag has happened, swallow the `click` that follows, with a one-shot capture listener on window cleared after 0ms or at the next `pointerdown`. That way the title doesn't rename and the row doesn't select.
- **While dragging:**
  - Measure `getBoundingClientRect` for each item element (`[data-task-id]` rows and heading buttons, in display order) when the drag starts and after each scroll.
  - Find the item under the pointer's y:
    - In the **top or bottom quarter** of a task row, or above or below a heading, the target is the gap before or after it.
    - In the **middle half** of a task row (not the dragged one, nor one under it), the target is `into`.
    - In the middle half of a heading, the target is the gap right after it at depth 0.
  - For a gap, the depth is `clamp(round((x - listLeft) / indent), min, max)` from `gapDepths`, where `indent` is the row's `--indent` in px. Read it from computed style, or use 20px.
  - For a heading drag, only `headingGaps` are valid: snap to the nearest valid gap.
  - Render:
    - an indicator (`div.drop-line`, absolutely positioned in `.task-sections`, which is `position: relative`) at the gap's y, left-offset by depth × indent;
    - or `data-drop-into` on the target row, styled with an outline;
    - a ghost (`div.drag-ghost`, fixed, `pointer-events: none`) holding the row's title, following the pointer;
    - `data-dragging` on the source row (and on its subtree or section), at opacity 0.4.
  - Auto-scroll: when the pointer is within 40px of the top or bottom of the scroll container (`.content`, found with `closest`), scroll it by up to 12px per animation frame, then re-measure.
- **Ending:**
  - **Escape** (a keydown listener during the drag that stops propagation, so the panel doesn't close) cancels: no request, and everything cleared.
  - **`pointerup`** runs `moveFor(withoutDragged(items, dragged), dragged, drop, items)`.
    - A request goes to `move.mutateAsync`, and errors go to the toast.
    - Null does nothing.
    - With no valid target, nothing happens.
- **Accessibility:** dragging is a mouse convenience. The keyboard path is Alt+arrows, so no ARIA live announcements are required.
- **jsdom:**
  - Element rectangles are 0 in jsdom. In tests, stub `getBoundingClientRect` on the rendered items: give row i `{top: 100 + 30*i, height: 30, left: 0, width: 600}`.
  - `useDrag` must read rectangles through `getBoundingClientRect` only, so the stubs work.
  - Make sure `PointerEvent` with `pointerType` and `button` works in the test setup. The swipe tests already polyfill it; check `web/src/test-setup.ts`.

**Tests (`drag.test.tsx`):**
1. Dragging row c (third) to the top gap of row a, then releasing, sends `{parentId: null, beforeId: a}` and renders c, a, b.
2. A press and release without moving doesn't move. A title click still renames, and a row click still selects.
3. A drop on the middle of b sends `{parentId: b}`, and c renders as b's subtask (depth 1).
4. A drop in the gap after a subtask with the pointer x at depth 0 makes the task top level after the parent. At depth 1 it becomes a sibling of the subtask.
5. A drop on the middle of a heading puts the task first in that section.
6. Dragging a heading to the end sends `withSection: true`, and the section moves.
7. Escape during a drag sends nothing, and the panel (if open) stays open.
8. A touch pointer doesn't drag.
9. On a view screen nothing drags.

**Commit:** `Drag tasks and headings to reorder a list`.

---

### Task 5: Drop on a sidebar list

**Files:**
- Modify `web/src/ui/Sidebar.tsx` (add `data-drop-list={list.id}` to each list's nav link), `web/src/ui/useDrag.ts`, `web/src/ui/TaskList.tsx` and `web/src/styles.css`.
- Test in `web/src/ui/drag.test.tsx`.

**Behaviour:**
- During a drag, `document.elementFromPoint(x, y)?.closest("[data-drop-list]")` finds a sidebar list.
  - A list other than the current one becomes the target. It gets `data-drop-target` and a highlight, and the in-list indicator hides.
  - The current list is not a target.
- On release over it:
  - Before moving, take `placeOf(items, dragged)` for Undo.
  - Send `move.mutateAsync({ id, listId, parentId: null, ...(heading ? { withSection: true } : {}) })`.
  - Toast "Moved to {list name}" with Undo, which moves it back with `{ listId: original, ...placeOf }`.
  - Errors go to the toast.
- On a narrow screen the sidebar is a drawer, but dragging is desktop only, so this is fine.
- jsdom lacks `elementFromPoint`, so stub `document.elementFromPoint` in the test.

**Tests:**
1. Dragging a task onto Errands in the sidebar sends `{listId: errands, parentId: null}`. The row leaves the list, and the toast says "Moved to Errands". Undo sends a move back with the original `listId` and `beforeId`, and the row returns.
2. Dropping on the current list's own link does nothing.

**Commit:** `Drop a dragged task on a sidebar list to move it there`.

---

### Task 6: Browser check and docs

1. Run `npm run dev` with the local D1 (token in the scratchpad's `pw/token`, Garden list id in `pw/garden`). Seed a list with a heading, tasks and subtasks.
2. With Playwright (Chromium, 1280×800, light and dark), check each of these and take a screenshot at each step:
   - drag a row between rows;
   - drag into a task;
   - drag a heading;
   - drop on the sidebar, with Undo;
   - Alt+↑ and Alt+↓.
3. Check that the order survives a reload. Look at the screenshots.
4. Mark the design doc `Status: approved; built.` and add an "As built" section for any deviations.
5. Add a dated `#Decision` line to the Obsidian note `~/Obsidian/2026/202610251245 own-task-store.md`, before the "Gate in mid-December" decision.
6. Commit `Mark drag reorder as built`.
