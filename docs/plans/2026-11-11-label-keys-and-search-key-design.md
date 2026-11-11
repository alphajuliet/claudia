# Label toggle keys and ⌘F for Search

Date: 2026-11-11. Status: approved; built.

Board cards (NEXT): "Shortcuts to toggle commonly-used labels for the selected task" and "Shortcut (e.g. Command+F) to go to the Search view" (#Desktop).

## Behaviour

- `e 1`, `e 2`, `e 3`, `e 4` toggle `next`, `wip`, `waitingOn` and `someday` (the labels behind the built-in views, in sidebar order) on the highlighted task. Matching ignores case; other labels are kept. Not on headings.
- A toast says "Added next" or "Removed next" with Undo, since removing a label can take the task out of the view it is in.
- `⌘F` (Mac) and `Ctrl+F` go to Search, from anywhere including text fields, and stop the browser's own find. On the Search screen they put the cursor back in the field, as `/` does. `⌘⇧F`, `Ctrl+Alt+F` and the like stay the browser's.
- Both are registered commands (`toggleLabel1` to `4`, and `Mod+f` on `search`), so the shortcuts overlay lists them (⌘F or Ctrl+F by platform) and the keymap editor will pick them up. "Mod" means Ctrl or ⌘ alone.

## Not in scope

Choosing which labels `e 1` to `e 4` use (comes with the keymap editor), and making the state labels exclusive (wip and next can both be set).
