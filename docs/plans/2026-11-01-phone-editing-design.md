# Phone layout and touch for editing tasks

Date: 2026-11-01. Status: approved; built.

Board card: "Phone layout and touch for editing tasks" (#Mobile). On a phone today, tapping a title renames it inline (bringing up the keyboard) and the title fills most of the row, so opening a task means hitting the margin. The sheet closes only with a small Close button, the checkbox is about 17px, and the on-screen keyboard can cover the field being edited. This card fixes getting in and out of a task, adds row swipes, and enlarges touch targets. It applies to touch screens (phone and iPad), detected per interaction by pointer type or `(pointer: coarse)`; mouse and keyboard behaviour on desktop is unchanged.

## Getting in and out

- On touch, tapping anywhere on a row except the checkbox or the ▸ toggle opens the task sheet, including a tap on the title. Renaming happens in the sheet's title field. A mouse click on the title still renames inline, and `e` still renames.
- The sheet's Close becomes **Done**: at least 44px, at the right of a header that stays at the top while the sheet scrolls.
- Back (the browser button, or the system Back gesture) closes the sheet, since the selected task is in the address (`?task=`). Swipe-down to close is not built.

## Row swipes

Touch only, built by hand on pointer events (no library).

- Swipe right reveals a green "Complete" strip under the row. Releasing past about 40% of the row width completes the task (the existing toast with Undo); short of that it springs back.
- Swipe left reveals two buttons, **Date** and **Snooze**. The row stays open until a tap elsewhere or another swipe; one row is open at a time.
  - **Date** opens a small bottom sheet with the Due field from the detail panel.
  - **Snooze** opens one with the Snooze field.
  - A quick choice closes the sheet, and so does its Done button.
- Rows keep `touch-action: pan-y`, so vertical scrolling is untouched. A swipe starts only once the movement is clearly horizontal.
- Headings don't swipe. Completed rows (Show completed) swipe right to reopen and don't swipe left.
- Every swipe action is also reachable from the checkbox and the sheet, so nothing depends on the gesture.

## Touch targets and the keyboard

- On touch screens rows are at least 44px tall. The checkbox stays about 22px to look at, with a 44px hit area. The ▸ toggle, the label chips' × and the sheet's buttons get 44px hit areas too.
- The sheet sizes itself to the visible viewport (`visualViewport`), so the iOS keyboard doesn't cover its lower part. A field that takes focus scrolls into view above the keyboard.

## Testing

- Component tests: on touch (pointer type `touch`) a tap on the title opens the sheet; with a mouse it renames. Swipe thresholds and actions use simulated pointer events: complete past the threshold with Undo, spring back short of it, Date and Snooze open their sheets, and a vertical drag doesn't swipe. Done closes the sheet.
- Playwright with touch emulation at 390px wide, light and dark. Then check on the phone after deploy.

## Not in scope

Drag to reorder (its own BACKLOG card), swipe-down to close, and the phone Today, Capture and Triage screens (their own card).

## As built

- Touch targets are a fixed 44px (`--touch`), not 2.75rem, because the root font is 14.5px. The checkbox shows at about 22px.
- A tap, or any rightward movement, on a row whose Date and Snooze are showing closes it without opening or completing the task. Completing the open row (checkbox, swipe or `x`) also closes it.
- A left drag stops at the width of the two buttons. Rows use `touch-action: pan-y pinch-zoom` and, on touch screens, no text selection (inputs excepted).
- The click after a swipe is ignored only within 500ms of lifting the finger, since iOS sends no click after a drag.
- A child losing the browser's implicit touch capture (when the row takes it) is not a cancel; only the row losing its own capture is. A browser check with touch emulation caught this; jsdom doesn't model implicit capture.
- The bottom sheet traps Tab, stops keys reaching the list's commands, hides the field's own label (its title says it), and says "This task no longer exists." for a deleted task.
- Checked in Chromium with touch emulation at 390px, light and dark; not yet on an iPhone. The sheet still uses the desktop label column on a phone; a phone layout for the panel itself is not part of this card.
