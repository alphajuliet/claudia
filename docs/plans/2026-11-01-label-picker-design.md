# Label picker

Date: 2026-11-01. Status: approved; built.

Board card: "Drop-down list for selecting a tag" (#Desktop #Mobile). The panel's "Add a label" field offered labels through a `<datalist>`, which desktop browsers show only once you type and iOS shows as a small bar above the keyboard. Andrew: it should work the same on mobile as on desktop, and pressing "Add a label" should bring up a list of current labels. Label management comes later.

## Behaviour

- Focusing or tapping the field opens a drop-down under it: every label not already on the task, alphabetical (ignoring case).
- Typing filters the list to names containing the text, ignoring case and a leading `#`. A name that isn't a label yet gets a last option, "Create “name”".
- A click or tap on a label adds it. The field keeps focus and the list stays open for another.
- ↓ and ↑ move the highlight (past either end back to the typed text). Enter adds the highlighted label, or else the typed name, in the existing label's own case when it matches one.
- Escape with the list open closes the list only; with it closed, Escape reaches the panel as before (saving any typed name, then closing).
- Leaving the field adds a typed name, as before. A failed save puts the name back in the field. A new name refreshes the labels, since the server creates it.
- Options are 44px tall on touch screens. The list scrolls past 16rem (45% of the screen height on touch) and scrolls itself into view above the keyboard.
- Accessibility: the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, a listbox of options).

## Not in scope

`#` suggestions in quick add, renaming, merging or deleting labels.

## Testing

Component tests for the list on tap, filtering and Create, tap-to-add keeping the list open, arrows and Enter, case matching, Create, restore on failure, and Escape closing the list before the panel. Checked in Chromium at 390px and desktop width, light and dark.
