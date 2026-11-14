import { generateKeyBetween } from "fractional-indexing";
import type { Folder } from "@claudia/shared";

/** The request to move a folder: no placement puts it last among its new siblings. */
export interface FolderMove { parentId: string | null; afterId?: string; beforeId?: string }

/**
 * Where a dragged folder lands: beside another folder, or in a folder (null for the top level), last or, with
 * `atStart`, first among its subfolders.
 */
export type FolderDrop = { kind: "before" | "after"; folderId: string } | { kind: "into"; folderId: string | null; atStart?: boolean };

const byPosition = (a: Folder, b: Folder) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Whether `folderId` is `id` or sits somewhere under it. */
function within(folders: Folder[], folderId: string | null, id: string): boolean {
  const parent = new Map(folders.map((f) => [f.id, f.parentId]));
  for (let at = folderId; at; at = parent.get(at) ?? null) if (at === id) return true;
  return false;
}

/** The request for dropping folder `id`, or null when it wouldn't move or can't go there (inside itself). */
export function folderMoveForDrop(folders: Folder[], id: string, drop: FolderDrop): FolderMove | null {
  const me = folders.find((f) => f.id === id);
  if (!me) return null;
  const target = drop.kind === "into" ? null : folders.find((f) => f.id === drop.folderId);
  if (drop.kind !== "into" && (!target || target.id === id)) return null;
  const parentId = drop.kind === "into" ? drop.folderId : target!.parentId;
  if (within(folders, parentId, id)) return null;
  const siblings = folders.filter((f) => f.parentId === parentId && f.id !== id).sort(byPosition);
  // The folder that follows it there, or none for last.
  const next = drop.kind === "into"
    ? (drop.atStart ? siblings[0] : undefined)
    : siblings[siblings.findIndex((f) => f.id === target!.id) + (drop.kind === "after" ? 1 : 0)];
  if (me.parentId === parentId) {
    const now = folders.filter((f) => f.parentId === parentId).sort(byPosition);
    if (now[now.findIndex((f) => f.id === id) + 1]?.id === next?.id) return null;
  }
  return next ? { parentId, beforeId: next.id } : { parentId };
}

/** The position that shows folder `id` where `move` puts it, or null when it can't be worked out here. */
export function folderPosition(folders: Folder[], id: string, move: FolderMove): string | null {
  const siblings = folders.filter((f) => f.id !== id && f.parentId === move.parentId).sort(byPosition);
  const anchor = move.afterId ?? move.beforeId;
  const at = anchor ? siblings.findIndex((f) => f.id === anchor) : siblings.length;
  if (at < 0) return null;
  const [low, high] = move.afterId ? [siblings[at], siblings[at + 1]] : [siblings[at - 1], siblings[at]];
  if (low && high && low.position >= high.position) return null;
  return generateKeyBetween(low?.position ?? null, high?.position ?? null);
}
