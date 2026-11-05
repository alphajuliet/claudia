# Label management and colours

Status: approved; built.

Board card: "Tag management" (the app calls them labels, so the screen does too).

## Data and API

- `labels.color`: nullable text, a palette name (`LABEL_COLOURS` in `shared`), checked by `labels_color_check`. Null is the default grey, so existing labels didn't change.
- Migration `0003_label_colour.sql` is hand-written as one `ALTER TABLE`; drizzle-kit wanted to rebuild the table with `DROP TABLE`.
- `POST /api/labels` takes an optional `color`; `PATCH /api/labels/{id}` takes `name` and/or `color` (at least one). A rename logs `renamed`, a colour change alone logs `updated`, each with the changed fields.
- Tasks still carry label names. The web app looks colours up from the cached `GET /api/labels`.
- MCP: `rename_label` became `update_label` (name and/or colour). MCP still has no delete tools, by design.

## Palette

16 named colours: red, orange, amber, yellow, lime, green, teal, cyan, sky, blue, indigo, violet, purple, pink, rose, brown. Each has a background and text shade for light and dark, set with `light-dark()` on `[data-color]` in `styles.css`. Every pair passes WCAG AA (lowest 5.95:1). Grey labels keep the plain chip.

## UI

- `LabelChip` colours every label chip: task rows (lists, views, Dashboard, Search) and the task panel. The label picker shows a colour dot beside each option.
- `/labels` (sidebar "Labels", `g #`): labels alphabetically, ignoring case, each with its open-task count from `/api/counts`. Add with the New label field; rename by clicking the chip or `e t`; Colour opens a grid of Default plus the 16 swatches (Escape closes); Delete (or the Delete key) asks first and says how many open tasks lose it. `j`/`k` move between rows.

## Not done

Merging two labels (a rename onto a taken name is a 409), restoring a deleted label, ordering labels by hand.
