# Phone editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make editing tasks on a phone or iPad comfortable: tap to open, a Done button, row swipes (complete; Date and Snooze), 44px touch targets, and a sheet the keyboard doesn't cover (design: `2026-11-01-phone-editing-design.md`).

**Architecture:** Touch is detected per interaction from the pointer type of the last `pointerdown` on the row, so a laptop with a touch screen behaves correctly either way. Swipe recognition is a pure function in `web/src/lib/swipe.ts`, and a `useSwipe` hook in `web/src/ui/useSwipe.ts` feeds it pointer events and sets a CSS offset. The Date and Snooze sheets reuse `DueField` and `SnoozeField` from `web/src/ui/DateFields.tsx` inside a small `BottomSheet` component. No API change.

**Tech Stack:** React, TanStack Query, Vitest with Testing Library (`fireEvent.pointerDown/Move/Up` with `pointerType: "touch"`), hand-written CSS. Run `npm test -w @claudia/web`, `npm run typecheck` and `npm run build` from the repo root.

Conventions: Australian English, short doc comments, small imperative commits ending with the `Co-Authored-By` line, tests first.

Notes on jsdom: `PointerEvent` may be missing. If `fireEvent.pointerDown(el, { pointerType: "touch" })` loses `pointerType`, add a minimal `PointerEvent` polyfill (extending `MouseEvent` with `pointerType`, `pointerId` and `isPrimary`) to `web/src/test-setup.ts`. Element widths are 0 in jsdom, so the swipe code must take the row width from a parameter or fall back to a fixed width (say 320) when `clientWidth` is 0.

---

### Task 1: Tap to open on touch, and Done

**Files:** Modify `web/src/ui/TaskRow.tsx`, `web/src/ui/TaskDetail.tsx`, `web/src/styles.css`; Test `web/src/ui/TaskDetail.test.tsx` or a new `web/src/ui/touch.test.tsx`.

**Behaviour:**
- `TaskRow` records the pointer type of the last `pointerdown` inside the row (a ref).
- When the title is clicked and that type is `"touch"` (or `"pen"`), it calls `onSelect(task)` instead of starting the rename. Mouse clicks and Enter or Space on the title rename as before. The `e` command still renames.
- The row's click handler (`onRowClick`) is unchanged for the margin.
- `TaskDetail`'s header button reads **Done** (accessible name "Done"). Update the existing tests that click "Close". The header sticks to the top of the sheet while it scrolls (`position: sticky; top: 0` with the panel background). Under `(pointer: coarse)` the button is at least 2.75rem tall and wide.

**Tests (write first):**
1. Touch: `pointerDown` with `pointerType: "touch"` on the title, then `click`. The address gains `?task=`, the panel opens, and there is no title textbox in the row.
2. Mouse: `pointerDown` with `pointerType: "mouse"`, then `click`. The inline title input appears and there is no `?task=`. Keep the existing tests that click without a pointerdown working: no recorded type means mouse.
3. The panel's "Done" button closes it.

**Commit:** `Open a task with a tap on touch screens and close it with Done`.

---

### Task 2: Touch targets and the keyboard

**Files:** Modify `web/src/styles.css`, `web/src/ui/TaskDetail.tsx`; Create `web/src/ui/useVisualViewport.ts`; Test `web/src/ui/TaskDetail.test.tsx`.

**Behaviour:**
- CSS under `@media (pointer: coarse)`:
  - `.task-row` gets a `min-height` of 2.75rem.
  - `.task-check` is 1.35rem to look at, with a 44px hit area from an absolutely positioned `::before` (`inset: calc((2.75rem - 1.35rem) / -2)`). Check that this doesn't make the row's own click handler take checkbox taps.
  - `button.disclosure::before`, `.chip-remove` (label chips in the panel) and the subtask checkboxes get the same 44px hit areas.
  - Sheet buttons (`.detail-header button`, `.detail-footer button`) are at least 2.75rem tall.
- Keyboard: a hook `useVisualViewport()` returns `window.visualViewport`'s `height` and `offsetTop`, updated on its `resize` and `scroll` events, or `null` where there's no `visualViewport`. Below 900px (`matchMedia("(max-width: 899.98px)")`), `TaskDetail` sets `style={{ height: vv.height, top: vv.offsetTop }}` on the `<aside>`, which is `position: fixed` there.
- A `focusin` listener on the `<aside>` calls `target.scrollIntoView({ block: "nearest" })` after the next animation frame, for inputs, textareas and selects only. Guard `scrollIntoView` being missing in jsdom.

**Tests:**
1. With a stubbed `window.visualViewport` (an `EventTarget` with `height: 500` and `offsetTop: 0`) and `matchMedia` saying narrow, the panel's inline `height` is `500px`. Firing `resize` with `height: 300` updates it.
2. Without `visualViewport` there's no inline height.
(The CSS is checked in the browser in Task 5.)

**Commit:** `Enlarge touch targets and keep the task sheet above the keyboard`.

---

### Task 3: Swipe right to complete

**Files:** Create `web/src/lib/swipe.ts`, `web/src/lib/swipe.test.ts`, `web/src/ui/useSwipe.ts`; Modify `web/src/ui/TaskRow.tsx`, `web/src/ui/TaskList.tsx`, `web/src/styles.css`; Test a new `web/src/ui/swipe.test.tsx`.

**Pure logic (`lib/swipe.ts`), test first:**

```ts
export type SwipePhase = "idle" | "pending" | "scrolling" | "swiping";
export interface SwipeState { phase: SwipePhase; startX: number; startY: number; dx: number }
export const SLOP = 10;              // px before a direction is decided
export const COMPLETE_AT = 0.4;      // share of the row width
export const REVEAL_WIDTH = 144;     // px of the Date and Snooze buttons
export const REVEAL_AT = 0.5;        // share of REVEAL_WIDTH to stay open

export const start = (x: number, y: number): SwipeState => ({ phase: "pending", startX: x, startY: y, dx: 0 });

/** A move: decides the direction once past SLOP (mostly vertical → scrolling, which is final), then tracks dx. */
export function move(s: SwipeState, x: number, y: number, allowLeft: boolean): SwipeState { … }

/** The outcome when the finger lifts. */
export function end(s: SwipeState, width: number): "complete" | "reveal" | "cancel" { … }
```

Rules:
- `pending` becomes `swiping` when `|dx| > SLOP` and `|dx| > |dy|`.
- It becomes `scrolling` when `|dy| > SLOP` first, and `scrolling` never swipes.
- When `!allowLeft`, `dx` is clamped at 0 or more.
- `end` gives `complete` when `dx ≥ width * COMPLETE_AT`, `reveal` when `dx ≤ -REVEAL_WIDTH * REVEAL_AT`, and otherwise `cancel`.

Unit-test each rule.

**Hook (`ui/useSwipe.ts`):**
- It handles touch `pointerdown`, `pointermove`, `pointerup` and `pointercancel` on the row, ignoring mouse and anything starting on a checkbox, button or input.
- While swiping it sets `--swipe-x` on the row and calls `setPointerCapture`.
- On `end`, `complete` calls `onComplete`. The `reveal` result is handled in Task 4; until then treat it as `cancel`. `cancel` animates back to 0.
- A click straight after a swipe is swallowed, so a swipe doesn't also open the sheet.
- Only touch rows use it: no-op for headings.

**Row rendering:**
- The row content is wrapped in an inner `.task-row-body` moved by `transform: translateX(var(--swipe-x, 0))`.
- Behind it sit an absolutely positioned `.swipe-complete` strip (green, "Complete" or, for a completed row, "Reopen") and, in Task 4, `.swipe-actions`.
- `touch-action: pan-y` on `.task-row`.
- Keep the row's existing classes, data attributes and accessible names, so the existing tests still pass.

**Tests (`ui/swipe.test.tsx`):**
1. A touch drag right of 200px (width fallback 320, threshold 128) completes: the POST to complete is sent and the toast shows Undo.
2. A drag of 60px springs back and sends nothing.
3. A drag that is mostly vertical (dx 30, dy 80) sends nothing.
4. A swipe then the click that follows doesn't open the panel.
5. A completed row (Show completed) swiped right reopens it.
6. A mouse drag does nothing.

**Commit:** `Swipe a task right to complete it on touch screens`.

---

### Task 4: Swipe left for Date and Snooze

**Files:** Create `web/src/ui/BottomSheet.tsx`; Modify `web/src/ui/useSwipe.ts`, `web/src/ui/TaskRow.tsx`, `web/src/ui/TaskList.tsx`, `web/src/ui/DateFields.tsx` (export `DueField` and `SnoozeField` if they aren't), `web/src/styles.css`; Test `web/src/ui/swipe.test.tsx`.

**Behaviour:**
- `reveal` leaves the row at `--swipe-x: -144px`, showing `.swipe-actions` with two buttons: **Date** and **Snooze** (accessible names `Date for {title}` and `Snooze {title}`).
- One row is open at a time. The list keeps the open row's id. Opening another row, tapping anywhere else, or scrolling closes it.
- A swipe right on an open row closes it rather than completing.
- Completed rows and headings never reveal.
- **Date** opens `BottomSheet` titled "Due" containing `DueField` for the task. **Snooze** opens it titled "Snooze" containing `SnoozeField`, with `onClose` closing the sheet.
- A quick choice closes the sheet: pass a callback that `WhenField` calls when `quick` is true. That already exists as the second argument of `onSave`, so wire Due's to close the sheet in this context only. The panel's Due field stays open.
- `BottomSheet`:
  - `role="dialog"`, `aria-modal="true"`, labelled by its title;
  - a backdrop that closes on tap;
  - a Done button at least 44px;
  - Escape closes it;
  - focus moves into it on open and back to the row on close;
  - fixed to the bottom with `padding-bottom: env(safe-area-inset-bottom)`, max height 80dvh, and scrolling inside.
- The Snooze toast and Undo behave as in the panel.

**Tests:**
1. A swipe left of 100px reveals the buttons; one of 30px doesn't.
2. Tapping Date opens a dialog named "Due". "Due: Tomorrow" sends the PATCH and closes the dialog.
3. Tapping Snooze then "Snooze: Tomorrow" sends `snoozedUntil`, closes the dialog, hides the row and shows the toast with Undo.
4. Opening a second row closes the first.
5. Escape and Done close the sheet.
6. A completed row doesn't reveal.

**Commit:** `Swipe a task left to set its date or snooze it`.

---

### Task 5: Check it in the browser, then document

1. With `npm run dev` and Playwright (Chromium with `hasTouch`, `isMobile`, 390×844, light and dark), seed tasks through the API.
   - Tap a title: the sheet opens with Done.
   - Swipe right: it completes, and Undo works.
   - Swipe left, then Date, then Tomorrow.
   - Swipe left, then Snooze.
   - Check that vertical scrolling of a long list still works.
   - Screenshot each step and look at the screenshots.
2. Mark the design doc `Status: approved; built.` and add an "As built" section for deviations.
3. Obsidian note: mark the 2026-11-01 phone editing decision as built, with the deviations.
4. Commit `Mark phone editing as built`.
5. Ask Andrew about merging and pushing, then move the card to DONE and ask him to try it on the phone.
