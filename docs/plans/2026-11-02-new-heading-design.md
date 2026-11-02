# New heading

Status: built.

A heading could only be made through the API or MCP. Now `n h`, or Add heading in a list's header, makes one and opens the panel with the title ready. It works like `n t`: the title starts as "New heading", and a heading left untouched is deleted when the panel closes.

- **Where it goes:** after the highlighted task, starting a section there. From a subtask it goes after the top-level task, as headings can't nest. On a heading it goes after that whole section. With nothing highlighted, or on the last heading, it goes last.
- **Lists only:** views and filters group by list, so they have no place for a heading, and show no button.
- **Touch:** a phone won't open its keyboard without a tap, and that tap would clear a selection. So on a coarse pointer the field starts empty, with "New heading" as its placeholder. Left empty, the title stays as it was.
- **One path:** the button runs the `newHeading` command (`useRunCommand`), so it and the key can't differ.

Not done: `::` in quick add, as in Godspeed. Reload or a closed tab with the panel open leaves "New heading" behind, as with `n t`.
