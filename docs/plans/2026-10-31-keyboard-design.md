# Desktop UI step 3: keyboard commands

Date: 2026-10-31. Status: approved; built.

Step 3 of the desktop daily driver (`2026-10-31-desktop-ui-design.md`). Every key runs a registered command, so the later `⌘K` palette and keymap editor can be built on the same registry.

## Registry

- Commands live in `web/src/lib/commands.ts`: an ID, a label and default keys (contexts come with the palette, when they're needed). Defaults follow Godspeed.
- One `keydown` listener on the window matches keys and runs the command.
- Keys are ignored while focus is in a text field, textarea, select or contenteditable, and when Ctrl, ⌘ or Alt is held, so typing and browser shortcuts are unaffected.
- A `g` chord waits about 1.5 seconds for its second key. Any other key cancels it.
- The keymap is code-only for now. Reading user bindings from the `keymap` setting comes with the keymap editor card.

| Keys | Command |
|---|---|
| `j` / `↓`, `k` / `↑` | Move the highlight down or up through rows and headings, wrapping at the ends |
| `Enter` / `o` | Open the panel for the highlighted task |
| `Esc` | Close the panel, keeping the highlight |
| `x` | Complete the highlighted task (toast with Undo); the highlight moves to the next row |
| `e` | Rename the highlighted task in place |
| `c` | Focus quick add |
| `/` | Search |
| `g i`, `g t`, `g n`, `g w`, `g o`, `g s` | Go to Inbox, Today, Next, WIP, Waiting (on), Someday |
| `?` | Show the shortcuts, listed from the registry |

## Highlight

- The highlighted row takes focus (`tabIndex=-1`) and shows an outline, so screen readers follow it.
- With no highlight, `j` starts at the first row and `k` at the last; if the open task is on screen, the highlight starts there.
- Moving past the last row wraps to the first, and past the first to the last.
- The highlight resets when the screen changes.
- While the panel is open, moving the highlight shows that task in the panel. These moves replace the history entry, so Back does not step through every task passed.
- When the panel closes (Esc or its close button), focus returns to that task's row.
- After `x`, a task that leaves the list hands the highlight to the next row (or the previous one at the end); a repeating task keeps it.

## Search

A `/search?q=` screen with a search field at the top, also linked from the sidebar. Results come from `GET /api/tasks?q=` (open tasks, title or notes), grouped by list as in views, and update as you type after a short pause. `/` opens it with the field focused.

## Drawer

Below 900px, opening the drawer moves focus into it and keeps Tab inside. Esc closes it and returns focus to the Menu button.

## Out of scope

The `⌘K` palette, the keymap editor, reordering, indenting or deleting from the keyboard, and keys inside the panel other than Esc.

## Testing

Unit tests for key matching (chords, timeout, modifiers, typing in fields) and wrap-around movement. Testing Library tests for each command, the panel following the highlight, focus return, search, and the drawer focus trap.
