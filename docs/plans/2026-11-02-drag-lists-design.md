# Drag lists in the sidebar

Date: 2026-11-02. Status: approved; built.

Board card: "Drag to re-order lists in the sidebar" (#Desktop #Mobile). The API can already reorder a list and move it to another folder (`POST /api/lists/{id}/move`), but the app has no way to do either. No API change.

## Behaviour

- A list drags with the same gesture as a task: with the mouse after 5px, and with press and hold on a touch screen, including in the phone's drawer. Moving first scrolls. A click or tap still opens the list, and Escape cancels.
- **Beside a list:** the top half of a row is before it and the bottom half after it, in that list's folder. A line shows the spot, and a drop where it already is shows nothing and sends nothing.
- **At the end of a folder with sub-folders:** several folders end at the same gap, so the sideways movement picks one, as it picks a task's depth. It starts from the list's own folder if that's one of them, or else the innermost, and each indent left or right is a level out or in. The line indents to the level, and when the list would go in an outer folder that folder's name lights up too. A sidebar shows a folder's lists above its sub-folders, so a list dropped in an outer folder lands after that folder's own lists, above its sub-folders, not at the line.
- **On a folder's name** (its middle half): it goes last in that folder, and the name lights up. The edges of a name are gaps, so a closed folder can be dropped past.
- **On the Lists heading:** it comes out of its folder and goes first among the unfiled lists. This also works when there are no unfiled lists to drop beside.
- Above the Lists heading, or outside the sidebar, a drop does nothing.
- It moves at once. A failed save puts it back and shows the error in the toast. There's no Undo: another drag does the same job.
- Folders don't drag. The Inbox and the views aren't in the list tree, so they stay where they are.

## Keyboard

Two registered commands, listed under `?`: **Alt+Shift+↑ / Alt+Shift+↓** move the open list one place. At the end of a folder it crosses into the next or previous group, in the order the sidebar shows them, so every drop has a keyboard route. They do nothing away from a list screen. Alt+↑/↓ stay with tasks.

## Code

- `web/src/ui/usePressDrag.ts`: the gesture, taken out of `useDrag` so both share it (hold, ghost, auto-scroll, Escape, second finger, the click after a drag).
- `web/src/lib/listMove.ts`: the rules, as pure functions.
- `web/src/ui/useListDrag.ts`: measuring the sidebar's rows, and showing the target.
- `useMoveList` in `web/src/data/queries.ts`: optimistic, one at a time, in order.

## As built

- Checked in Chromium at 1280px with the mouse and keyboard, and at 390px in the drawer with touch emulation: a line, a folder drop, a move out of order after a reload, no `pointercancel`, no scroll under the finger. Not yet checked in Safari on an iPhone.
- The list's position among the others can't be worked out locally if two neighbours share a position. Then the list stays put until the save returns.
