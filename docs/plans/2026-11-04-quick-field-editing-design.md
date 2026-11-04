# Quick editing of task fields from the keyboard

Date: 2026-11-04. Status: approved; built (3ed573e).

Board cards: "Highlight the first task when a list is selected" and "Quick editing of task fields" (#Desktop).

## Behaviour

- Selecting a list or view highlights its first row, so j and k have a starting point. Not on touch screens, and not when a task is already open (`?task=`). A highlight the user has moved is left alone.
- Enter on the highlighted row opens the panel (as before). Enter again, with focus on the panel itself or on the row while the panel is open, puts the cursor at the end of the title.
- Enter in the title saves it and moves focus to the panel, so the keys below work again.
- With the panel open, `e t` edits the title, `e n` the notes (formatted notes turn into the editor) and `e l` focuses Add a label with its drop-down open. Typing in a field never triggers them (`ignoresKeys`).
- `e t` replaces the bare `e` (rename) from the list: `e` is now a chord prefix, like `n` and `p`, and the matcher can't give one key both meanings. With the panel closed, `e t` renames the highlighted row in place, as `e` did.
- Priority keeps `p h`, `p n` and `p l`. No cycling key.

## How

Each key is a registered command (`rename` now `e t`, plus `editNotes` and `editLabels`), handled by the field that owns the control, so it only exists while the panel is mounted. The list's rename steps aside when the panel's title is on screen.

## Not in scope

Keys for the other panel fields (date, list, repeat), and the keymap editor.
