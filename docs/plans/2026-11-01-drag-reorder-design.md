# Drag tasks within and between headings

Date: 2026-11-01. Status: approved.

Board card: "Drag tasks within and between headings in a list" (#Desktop). Tasks keep their order (fractional `position`) and the API can move them (`POST /api/tasks/{id}/move` with `listId`, `parentId`, `afterId` or `beforeId`), but the web app has no way to reorder. This card adds dragging with the mouse on list screens, Alt+↑ and Alt+↓ from the keyboard, moving a heading with its section, and dropping on a sidebar list.

## Dragging

Mouse only, on list screens (`/list/:id`). Views (Today, Next and so on), filters and search don't drag: their order is the lists'.

- A drag starts once the mouse has moved 5px with the button down on a task row or a heading. A press on the checkbox, the ▸ toggle or a field never starts one, and a click without movement still renames (title) or selects (row) as before.
- While dragging, a copy of the row follows the pointer and the original fades. An accent line shows where it will land, indented to that depth, or the target row is outlined when the drop makes a subtask.
- **Between rows**, the pointer's horizontal position picks the depth from those the neighbours allow: no deeper than the row above, and no shallower than the row below. Next to a heading only the top level is possible.
- **Over the middle of a task row** (its middle half), the dragged task becomes that task's last subtask, collapsed or not. **Over a heading**, it goes first in that heading's section.
- Subtasks always move with their task. A task can't be dropped into itself or its subtasks.
- **A heading** drags with its section: the top-level tasks down to the next heading, including completed and snoozed ones that aren't on screen. It lands only between sections (before another heading or at the end of the list), never among the tasks above the first heading.
- **On a sidebar list**, a drop moves the task (or the heading and its section) to the end of that list at the top level. The list highlights while the pointer is over it. A toast says "Moved to Errands" with Undo, which puts it back where it was.
- Escape cancels a drag. Near the top or bottom of the list the content scrolls.
- The row lands at once. A failed save puts it back and shows the error in the toast. A drop where it already was sends nothing.

## Keyboard

Two registered commands, listed under `?`:

- **Alt+↑ / Alt+↓** move the highlighted task past its neighbour. Subtasks stay under their parent. A top-level task crosses headings: moving up past its heading puts it at the end of the section above, and moving down past the next heading puts it first in that section. The highlight and focus stay with it.
- On a heading they move the whole section past the neighbouring section. A heading doesn't move above the tasks before the first heading.
- Keys with Alt were ignored until now. Only these bindings use it, so typing and browser shortcuts are unaffected.

## API

`POST /api/tasks/{id}/move` (and the MCP `move_task` tool) gains `withSection: true` for headings. The heading moves to the placement given, and its section (the top-level tasks after it down to the next heading, open or not, with their subtasks) moves straight after it in the same order, to another list if `listId` says so. It is one batch, so a section never ends up split. The placement may not be inside the section itself.

## Testing

- API tests for `withSection`: in place, past another section, to another list, and the placement-inside-the-section error.
- Unit tests for the drop rules (allowed depths, the move request for each kind of drop, no-ops, heading boundaries) and the keyboard moves.
- Component tests for dragging with simulated pointer events (between rows, depth by x, into a task, onto a heading, heading sections, the sidebar drop with Undo, Escape) and Alt+↑/↓.
- A browser check in Chromium at desktop width, light and dark.

## Not in scope

Dragging on touch screens or the iPad, dragging in views or filters, several tasks at once, and indenting or outdenting from the keyboard.
