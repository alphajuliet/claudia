# Drag tasks to reorder on touch screens

Date: 2026-11-01. Status: approved; built.

Board card: "Drag tasks to reorder on touch screens (press and hold)" (#Mobile). Dragging (`2026-11-01-drag-reorder-design.md`) works with a mouse only. On a phone or iPad there's no way to reorder. This card adds press and hold to start the same drag on touch screens, on list screens.

## Behaviour

- Pressing and holding a task row or a heading for 500ms without moving more than 10px starts a drag. The row lifts (a shadow), then the ghost, drop line and "into" outline from the desktop drag follow the finger.
- Moving first keeps today's gestures. Vertical movement scrolls, horizontal movement swipes (complete, or Date and Snooze), and a quick tap opens the task. Once a drag has started, the swipe for that touch is cancelled.
- While dragging, the page doesn't scroll under the finger. It scrolls by itself near the top or bottom edge, as on desktop. Sideways movement picks the depth.
- The drop rules, headings with their sections, optimistic moves and errors are all the desktop drag's.
- Where the sidebar is showing (an iPad in landscape), a drop on a sidebar list moves the task there, with the Undo toast. On a phone the sidebar is a closed drawer, so there's no list drop.
- Lifting the finger without having moved after the lift does nothing, and the click that follows is ignored. A touch cancelled by the system (`pointercancel` or `touchcancel`) cancels the drag.
- Rows turn off iOS's callout (`-webkit-touch-callout: none`) and text selection on touch screens, so a long press doesn't bring up the copy or look-up menu.
- No haptics: Safari on iOS doesn't offer vibration.

## Not in scope

Move up or Move down buttons, and dragging in views or filters.

## Testing

- Component tests with touch pointer events and fake timers:
  - a hold, then a move, then a release moves the task;
  - moving before 500ms doesn't drag (and a horizontal move still swipes);
  - a hold then a release without moving does nothing, and the click is ignored;
  - a cancelled touch cancels the drag.
- Chromium with touch emulation (CDP `Input.dispatchTouchEvent`) at 390px and at iPad width. Then on the iPhone after the deploy.

## As built

- A heading drags from anywhere on its line (`h2.section-title`) except the ▸ toggle, with the mouse as well as on touch. A tap or click on its title still selects it.
- On the lift the ghost shows at once, but no drop line or target appears until the finger moves. Lifting a row showing Date and Snooze closes them.
- The row lifted stays bright with a shadow while its subtasks fade. A heading's whole section fades, so its shadow is muted.
- The page is held still by a non-passive `touchmove` listener on the rows' container, there for as long as the list is, because browsers only honour `preventDefault` from a listener that was non-passive when the touch began. The drag itself still runs on pointer events.
- A second finger anywhere cancels a hold or a drag, so a pinch can't turn into one. The click after a hold is ignored for up to 500ms, or until the next press anywhere.
- Checked in Chromium with touch emulation at 390px and 1180px: row and heading drags (no `pointercancel`, no page scroll), hold then release, tap, swipes, and a sidebar drop with Undo. Not yet checked in Safari on an iPhone: the callout, the scroll hold and the bounce need a real device.
