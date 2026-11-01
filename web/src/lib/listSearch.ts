import type { Folder, List } from "@claudia/shared";
import { sidebarTree, type FolderNode } from "./sidebar";
import { findInbox } from "./views";

export interface ListChoice { id: string; name: string; href: string; path: string }

/** Every live list to jump to, the Inbox first and then in sidebar order, whatever the context. */
export function listChoices(folders: Folder[], lists: List[]): ListChoice[] {
  const inbox = findInbox(lists);
  const tree = sidebarTree(folders, lists.filter((l) => l.id !== inbox?.id), "all");
  const choice = (l: List, path: string): ListChoice => ({ id: l.id, name: l.name, href: `/list/${l.id}`, path });
  const out: ListChoice[] = inbox ? [{ id: inbox.id, name: inbox.name, href: "/inbox", path: "" }] : [];
  out.push(...tree.lists.map((l) => choice(l, "")));
  const walk = (n: FolderNode, above: string) => {
    const path = above ? `${above} › ${n.folder.name}` : n.folder.name;
    out.push(...n.lists.map((l) => choice(l, path)));
    n.folders.forEach((f) => walk(f, path));
  };
  tree.folders.forEach((f) => walk(f, ""));
  return out;
}

/** Lower case words without accents, emoji or punctuation: "✈️ Travel & expenses" is "travel expenses". */
const words = (text: string) =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** How well the name matches every query word: 0 starts with the query, 1 a word starts with each, 2 it's in there. Null for no match. */
function rank(name: string, query: string): number | null {
  const parts = query.split(" ");
  if (!parts.every((p) => name.includes(p))) return null;
  if (name.startsWith(query)) return 0;
  return parts.every((p) => ` ${name}`.includes(` ${p}`)) ? 1 : 2;
}

/** The choices matching `query`, best first and otherwise in order; all of them for an empty query. */
export function matchLists(choices: ListChoice[], query: string): ListChoice[] {
  if (!query.trim()) return choices;
  const q = words(query);
  if (!q) return [];
  return choices
    .flatMap((c) => {
      const r = rank(words(c.name), q);
      return r === null ? [] : [{ c, r }];
    })
    .sort((a, b) => a.r - b.r)
    .map(({ c }) => c);
}
