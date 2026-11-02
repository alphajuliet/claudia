# Keyboard shortcuts: context, moving tasks and jumping to a list

Date: 2026-11-02. Status: approved; built.

Board cards: "Add shortcuts to change the context", "Add shortcuts to move tasks up and down, and indent in and out" and "Add shortcut to jump to a list, using autocomplete" (all #Desktop). No API change.

## Context

`1` `2` `3` `4` choose All, Work, Personal and Home, in the order of the buttons. `c w` can't work: `c` is Add a task, and a key that starts a chord stops running as a command, silently. A test now fails if that ever happens.

## Moving tasks

`Shift+J` and `Shift+K` are the same commands as Alt+↓ and Alt+↑. `Shift+L` and `Shift+H` indent and outdent the highlighted task. Lower-case `h` and `l` stay as collapse and expand.

- **Indent:** the task becomes the last subtask of the task above it at its depth. A collapsed parent opens, or the task would go out of sight. It does nothing on the first task in a section or under a parent, on a heading, or under a completed task, where it would vanish once completed tasks are hidden.
- **Outdent:** the task lands straight after its old parent. Tasks that were below it stay under that parent.
- All of these work on list screens only: a view's order isn't the list's own.

## Jumping to a list

`g l` opens a pop-up with a field and the lists: the Inbox first, then sidebar order, each with its folder path.

- It matches every word anywhere in the name, ignoring case, accents, emoji and punctuation, so "tra" finds "✈️ Travel & expenses". Names starting with the query come first, then names with a word starting with it.
- ↑ and ↓ choose, Enter goes, and Escape or the backdrop closes it and gives focus back.
- It searches every live list whatever the context, and leaves the context alone, so the list opened may not be in the sidebar.
- The picker is its own component, so "Shortcut to move a task to another list" can use it.

## As built

- The shortcuts overlay now shows Shift as ⇧ (it read "⌥Shift+ArrowUp").
- Checked in Chromium at 1280px, light and dark: context keys, the picker, and L, H and K with focus kept and the order held after a reload.
