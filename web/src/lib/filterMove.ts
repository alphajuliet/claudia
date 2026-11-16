import type { ListMove } from "./listMove";
import type { FolderNode, SidebarTree } from "./sidebar";

/** Where a dragged smart view lands: beside another, or in a folder (null for the Smart views section), last. */
export type FilterDrop = { kind: "before" | "after"; filterId: string } | { kind: "into"; folderId: string | null };

interface Group { folderId: string | null; ids: string[] }

/** The smart views in each place the sidebar shows them: outside any folder, then in each folder, subfolders after. */
function groups(tree: SidebarTree): Group[] {
  const out: Group[] = [{ folderId: null, ids: tree.filters.map((f) => f.id) }];
  const walk = (n: FolderNode) => {
    out.push({ folderId: n.folder.id, ids: n.filters.map((f) => f.id) });
    n.folders.forEach(walk);
  };
  tree.folders.forEach(walk);
  return out;
}

/** The request for dropping smart view `id` (the same shape as moving a list), or null when it wouldn't move. */
export function filterMoveForDrop(tree: SidebarTree, id: string, drop: FilterDrop): ListMove | null {
  const all = groups(tree);
  const from = all.find((g) => g.ids.includes(id));
  if (!from) return null;
  let to: Group | undefined;
  let next: string | undefined;
  if (drop.kind === "into") {
    to = all.find((g) => g.folderId === drop.folderId);
  } else {
    if (drop.filterId === id) return null;
    to = all.find((g) => g.ids.includes(drop.filterId));
    const rest = to?.ids.filter((other) => other !== id) ?? [];
    next = rest[rest.indexOf(drop.filterId) + (drop.kind === "after" ? 1 : 0)];
  }
  if (!to) return null;
  if (to === from && to.ids[to.ids.indexOf(id) + 1] === next) return null;
  return next ? { folderId: to.folderId, beforeId: next } : { folderId: to.folderId };
}
