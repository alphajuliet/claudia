import type { Folder, List } from "@claudia/shared";

export type ContextFilter = "all" | Folder["context"];
export interface FolderNode { folder: Folder; lists: List[]; folders: FolderNode[] }
export interface SidebarTree { lists: List[]; folders: FolderNode[] }

const byPosition = <T extends { position: string }>(a: T, b: T) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/**
 * Folders and live lists as a tree, both in position order. Folders outside the context are dropped
 * with everything under them; lists not in any folder show in every context.
 */
export function sidebarTree(folders: Folder[], lists: List[], context: ContextFilter): SidebarTree {
  const live = lists.filter((l) => l.archivedAt === null);
  const node = (f: Folder): FolderNode => ({
    folder: f,
    lists: live.filter((l) => l.folderId === f.id).sort(byPosition),
    folders: folders.filter((c) => c.parentId === f.id && (context === "all" || c.context === context)).sort(byPosition).map(node),
  });
  return {
    lists: live.filter((l) => l.folderId === null).sort(byPosition),
    folders: folders.filter((f) => f.parentId === null && (context === "all" || f.context === context)).sort(byPosition).map(node),
  };
}

/** List IDs in the order the sidebar shows them: unfiled lists, then each folder's lists before its subfolders. */
export function listOrder(tree: SidebarTree): string[] {
  const out = tree.lists.map((l) => l.id);
  const walk = (n: FolderNode) => {
    out.push(...n.lists.map((l) => l.id));
    n.folders.forEach(walk);
  };
  tree.folders.forEach(walk);
  return out;
}
