import { generateKeyBetween } from "fractional-indexing";
import type { List } from "@claudia/shared";
import type { FolderNode, SidebarTree } from "./sidebar";

/** The request to move a list: no placement puts it last in the folder. */
export interface ListMove { folderId: string | null; afterId?: string; beforeId?: string }

/** Where a drag ends: beside a list, or on a folder's name (or, with null, the Lists heading). */
export type ListDrop = { kind: "before" | "after"; listId: string } | { kind: "folder"; folderId: string | null };

interface Group { folderId: string | null; ids: string[] }

/** The groups of lists in the order the sidebar shows them: the unfiled lists, then each folder before its subfolders. */
function groups(tree: SidebarTree): Group[] {
  const out: Group[] = [{ folderId: null, ids: tree.lists.map((l) => l.id) }];
  const walk = (n: FolderNode) => {
    out.push({ folderId: n.folder.id, ids: n.lists.map((l) => l.id) });
    n.folders.forEach(walk);
  };
  tree.folders.forEach(walk);
  return out;
}

/** The request for dropping list `id`, or null when it wouldn't move. */
export function moveForDrop(tree: SidebarTree, id: string, drop: ListDrop): ListMove | null {
  const all = groups(tree);
  const from = all.find((g) => g.ids.includes(id));
  if (!from) return null;
  // Where it lands: the group, and the list that follows it there (none for last).
  let to: Group | undefined;
  let next: string | undefined;
  if (drop.kind === "folder") {
    to = all.find((g) => g.folderId === drop.folderId);
    // The heading sits above the unfiled lists, and a folder's name takes it to its end.
    if (drop.folderId === null) next = to?.ids.find((other) => other !== id);
    if (to && drop.folderId === null && to.ids[0] === id) return null;
  } else {
    if (drop.listId === id) return null;
    to = all.find((g) => g.ids.includes(drop.listId));
    const rest = to?.ids.filter((other) => other !== id) ?? [];
    next = rest[rest.indexOf(drop.listId) + (drop.kind === "after" ? 1 : 0)];
  }
  if (!to) return null;
  if (to === from && to.ids[to.ids.indexOf(id) + 1] === next) return null;
  return next ? { folderId: to.folderId, beforeId: next } : { folderId: to.folderId };
}

/** The request for moving list `id` one place up or down the sidebar, or null at the end. */
export function moveForStep(tree: SidebarTree, id: string, delta: 1 | -1): ListMove | null {
  const all = groups(tree);
  const g = all.findIndex((group) => group.ids.includes(id));
  if (g < 0) return null;
  const { folderId, ids } = all[g]!;
  const neighbour = ids[ids.indexOf(id) + delta];
  if (neighbour) return delta < 0 ? { folderId, beforeId: neighbour } : { folderId, afterId: neighbour };
  const beyond = all[g + delta];
  if (!beyond) return null;
  const first = beyond.ids[0];
  return delta > 0 && first ? { folderId: beyond.folderId, beforeId: first } : { folderId: beyond.folderId };
}

const byPosition = (a: List, b: List) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** The position that shows list `id` where `move` puts it, or null when it can't be worked out here. */
export function listPosition(lists: List[], id: string, move: ListMove): string | null {
  const siblings = lists.filter((l) => l.id !== id && l.folderId === move.folderId).sort(byPosition);
  const anchor = move.afterId ?? move.beforeId;
  const at = anchor ? siblings.findIndex((l) => l.id === anchor) : siblings.length;
  if (at < 0) return null;
  const [low, high] = move.afterId ? [siblings[at], siblings[at + 1]] : [siblings[at - 1], siblings[at]];
  if (low && high && low.position >= high.position) return null;
  return generateKeyBetween(low?.position ?? null, high?.position ?? null);
}
