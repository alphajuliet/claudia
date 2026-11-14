# Folder and list management in the sidebar

Status: built, 14 November 2026.

## What it does

- **Menus.** Each folder, each list and the Lists heading has a ⋯ button that opens a small menu. With a mouse it shows while the row is hovered or has focus; on a touch screen it always shows.
  - Folder: New list, New folder, Rename, Delete.
  - List: Rename, Archive, Delete.
  - Lists heading: New list, and New folder. Under the All context this is New Work folder, New Personal folder and New Home folder, since a top-level folder needs a context. Otherwise it uses the context shown.
- **Creating.** New list and New folder show a name field where the item will go: a list after the folder's lists, a folder after its subfolders. A closed folder opens for it. Enter, or leaving the field with a name, makes it; Escape or an empty name cancels. A new list opens.
- **Deleting.** Only empty lists and folders can be deleted, as the API already required.
  - The menu disables Delete, with the reason, for a folder showing lists or subfolders and for a list with open tasks.
  - For what the sidebar can't see (completed tasks, archived lists), the server's refusal shows in the toast.
  - There's no restore, so deleting offers no Undo.
- **Archiving** takes a list out of the sidebar and the views, with Undo in the toast. There is no screen for archived lists yet.
- **Dragging folders** uses the same gesture as lists (mouse, or press and hold on touch) and the same drop line and lit-up folder name:
  - The middle half of a folder's name puts it inside that folder, last.
  - The top quarter puts it before that folder.
  - The bottom quarter puts it after that folder. For an open folder with something showing in it, it goes first inside instead.
  - A list row stands for its folder: first among the subfolders that follow its lists.
  - The Lists heading is the top of the top level, and below the last row is its end.
  - A folder can't go inside itself.
- **The menu and the keyboard.** The menu takes focus and moves with ↑ and ↓ (Home and End too). Escape closes it and gives focus back to the button; Tab or a click elsewhere also closes it. Keys pressed in it don't reach the app's shortcuts.

## Context follows the parent

The sidebar shows a subfolder only in its own context. So a subfolder in a different context from its parent would vanish from the parent's context. The API now keeps them together (`worker/src/domain/folders.ts`):

- Creating a subfolder gives it the parent's context, and `context` is needed only at the top level. Without one the API returns 422 `context_required`.
- Moving a folder under another gives it, and every folder under it, the new parent's context. Moving to the top level keeps the context it has.
- Changing a top-level folder's context changes the folders under it. Changing a subfolder's context to something other than its parent's is refused with 422 `context_inherited`.
- Each folder changed this way gets an `updated` event.

Data from before this change may still have mismatched subfolders. The views still handle them as before.

## Not done

- Keyboard commands for these actions (for example, a key to open the menu of the open list).
- A screen for archived lists, to find and unarchive them.
- Undo for delete. It would need restore endpoints, which the BACKLOG has for tasks.
