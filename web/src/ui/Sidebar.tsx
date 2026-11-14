import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import type { CONTEXTS, Counts, Folder, List } from "@claudia/shared";
import { useArchiveList, useCounts, useCreateFolder, useCreateList, useDeleteContainer, useFilters, useFolders, useLists, useMoveFolder, useMoveList, useViews } from "../data/queries";
import { folderMoveForDrop, type FolderMove } from "../lib/folderMove";
import { moveForDrop, moveForStep, type ListMove } from "../lib/listMove";
import { listOrder, sidebarTree, type FolderNode } from "../lib/sidebar";
import { findInbox, VIEWS } from "../lib/views";
import { useSession } from "../session/SessionProvider";
import { CONTEXT_CHOICES, useContextFilter } from "./contextFilter";
import { Logo } from "./Logo";
import { InlineRename, useRenameReported } from "./InlineRename";
import { useCommand } from "./keyboard";
import { wrapIndex } from "../lib/keymap";
import { canShake, useShakeSetting } from "./shakeToUndo";
import { THEME_CHOICES, useTheme } from "./theme";
import { useToast } from "./Toast";
import { useListDrag } from "./useListDrag";
import { RowMenu, type MenuItem } from "./RowMenu";

type Context = (typeof CONTEXTS)[number];

/** A list or folder being named, before it's made: where it goes, and for a top-level folder its context. */
interface Creating { kind: "list" | "folder"; parentId: string | null; context?: Context }

/** What the rows' menus do, given by the Sidebar. */
interface SidebarActions {
  creating: Creating | null;
  create: (what: Creating) => void;
  finishCreate: (name: string | null) => void;
  archiveList: (list: List) => void;
  deleteList: (list: List) => void;
  deleteFolder: (folder: Folder) => void;
}
const ActionsContext = createContext<SidebarActions | null>(null);
const useActions = () => useContext(ActionsContext)!;

const CONTEXT_NAMES: Record<Context, string> = { work: "Work", personal: "Personal", home: "Home" };

/** The field that names a new list or folder: Enter (or leaving it with a name) makes it, Escape cancels. */
function NewItemField({ kind }: { kind: "list" | "folder" }) {
  const { finishCreate } = useActions();
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    finishCreate(name?.trim() || null);
  };
  return (
    <li className="nav-new">
      <input
        autoFocus
        className="nav-rename"
        aria-label={kind === "list" ? "New list name" : "New folder name"}
        placeholder={kind === "list" ? "List name" : "Folder name"}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") finish(e.currentTarget.value);
          else if (e.key === "Escape") {
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </li>
  );
}

/** Whether the field for a new `kind` in `parentId` is showing. */
const isCreating = (creating: Creating | null, kind: "list" | "folder", parentId: string | null) =>
  creating?.kind === kind && creating.parentId === parentId;

/** A sidebar link, with its count of open tasks when there are any. */
function NavLink({ href, children, count, onNavigate, onDoubleClick, dropList }: {
  href: string;
  /** The list a dragged task dropped here moves to. */
  dropList?: string;
  children: ReactNode;
  count?: number;
  onNavigate: () => void;
  onDoubleClick?: () => void;
}) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Link
      href={href}
      className="nav-link"
      draggable={false}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
      onDoubleClick={onDoubleClick}
      title={onDoubleClick ? "Double-click to rename" : undefined}
      data-drop-list={dropList}
    >
      <span className="nav-name">{children}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </Link>
  );
}

/** A list's link, renamed in place on double-click, with a menu: Rename, Archive and Delete. */
function ListLink({ list, counts, onNavigate }: { list: List; counts: Counts | undefined; onNavigate: () => void }) {
  const rename = useRenameReported("lists");
  const { archiveList, deleteList } = useActions();
  const open = listCount(counts, list.id) ?? 0;
  return (
    <InlineRename name={list.name} label="List name" className="nav-rename" onRename={(name) => rename(list.id, name)}>
      {(start) => (
        <div className="nav-row">
          <NavLink href={`/list/${list.id}`} count={listCount(counts, list.id)} onNavigate={onNavigate} onDoubleClick={start} dropList={list.id}>
            {list.name}
          </NavLink>
          <RowMenu label={`${list.name} list menu`} items={[
            { label: "Rename", onSelect: start },
            { label: "Archive", onSelect: () => archiveList(list) },
            { label: "Delete", danger: true, onSelect: () => deleteList(list), disabledNote: open > 0 ? "Move or delete its tasks first" : undefined },
          ]} />
        </div>
      )}
    </InlineRename>
  );
}

/** Open tasks in a list, from the counts. */
const listCount = (counts: Counts | undefined, id: string) => counts?.lists[id]?.open;

/**
 * A folder: its name (renamed on double-click, dragged like a list) with a menu of New list, New folder, Rename and
 * Delete (only when empty), then its lists and subfolders.
 */
function FolderItem({ node, counts, onNavigate }: { node: FolderNode; counts: Counts | undefined; onNavigate: () => void }) {
  const rename = useRenameReported("folders");
  const { creating, create, deleteFolder } = useActions();
  const { folder } = node;
  const empty = node.lists.length === 0 && node.folders.length === 0;
  return (
    <li>
      <details open className="folder" data-folder={folder.id}>
        <summary data-folder-row={folder.id}>
          <InlineRename name={folder.name} label="Folder name" className="nav-rename" onRename={(name) => rename(folder.id, name)}>
            {(start) => (
              <>
                <span className="folder-name" title="Double-click to rename" onDoubleClick={(e) => { e.preventDefault(); start(); }}>
                  {folder.name}
                </span>
                <RowMenu label={`${folder.name} folder menu`} items={[
                  { label: "New list", onSelect: () => create({ kind: "list", parentId: folder.id }) },
                  { label: "New folder", onSelect: () => create({ kind: "folder", parentId: folder.id }) },
                  { label: "Rename", onSelect: start },
                  { label: "Delete", danger: true, onSelect: () => deleteFolder(folder), disabledNote: empty ? undefined : "Move or delete its lists and folders first" },
                ]} />
              </>
            )}
          </InlineRename>
        </summary>
        <ul className="nav-list">
          {node.lists.map((l) => (
            <li key={l.id} data-list-row={l.id}><ListLink list={l} counts={counts} onNavigate={onNavigate} /></li>
          ))}
          {isCreating(creating, "list", folder.id) && <NewItemField kind="list" />}
          {node.folders.map((f) => <FolderItem key={f.folder.id} node={f} counts={counts} onNavigate={onNavigate} />)}
          {isCreating(creating, "folder", folder.id) && <NewItemField kind="folder" />}
        </ul>
      </details>
    </li>
  );
}

/** The Lists heading's menu: a list outside any folder, or a top-level folder in the context shown (or a chosen one under All). */
function ListsHeadingMenu({ context }: { context: "all" | Context }) {
  const { create } = useActions();
  const folderItems: MenuItem[] = context === "all"
    ? (["work", "personal", "home"] as const).map((c) => ({ label: `New ${CONTEXT_NAMES[c]} folder`, onSelect: () => create({ kind: "folder", parentId: null, context: c }) }))
    : [{ label: "New folder", onSelect: () => create({ kind: "folder", parentId: null, context }) }];
  return <RowMenu label="Lists menu" items={[{ label: "New list", onSelect: () => create({ kind: "list", parentId: null }) }, ...folderItems]} />;
}

/** The keys for a context (1 to 4, in the order of the buttons). */
function ContextCommand({ choice, onChoose }: { choice: (typeof CONTEXT_CHOICES)[number]; onChoose: () => void }) {
  useCommand(choice.command, onChoose);
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Views, filters and lists. As a drawer (`drawerOpen`, on narrow screens) it takes focus when it opens and keeps
 * Tab inside it, and Escape calls `onCloseDrawer`.
 */
export function Sidebar({ onNavigate, drawerOpen = false, onCloseDrawer }: { onNavigate: () => void; drawerOpen?: boolean; onCloseDrawer?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  useEffect(() => {
    if (drawerOpen) focusables()[0]?.focus();
  }, [drawerOpen]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!drawerOpen) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onCloseDrawer?.();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const { state, signOut } = useSession();
  const [theme, setTheme] = useTheme();
  const [shake, setShake] = useShakeSetting();
  const [shakeable] = useState(canShake);
  const { context, setContext } = useContextFilter();
  const folders = useFolders().data ?? [];
  const lists = useLists().data ?? [];
  const filters = [...(useFilters().data ?? [])].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const inboxId = findInbox(lists)?.id;
  // The Inbox list already shows as the Inbox view, so it stays out of the tree.
  const tree = sidebarTree(folders, lists.filter((l) => l.id !== inboxId), context);
  const counts = useCounts().data;
  const toast = useToast();
  const moveList = useMoveList();
  const move = (id: string, to: ListMove) => {
    moveList.mutateAsync({ id, ...to }).catch((e: Error) => toast.show({ message: e.message, error: true }));
  };
  const moveFolder = useMoveFolder();
  const onMoveFolder = (id: string, to: FolderMove) => {
    moveFolder.mutateAsync({ id, ...to }).catch((e: Error) => toast.show({ message: e.message, error: true }));
  };
  const drag = useListDrag({
    plan: (id, drop) => moveForDrop(tree, id, drop),
    onMove: move,
    planFolder: (id, drop) => folderMoveForDrop(folders, id, drop),
    onMoveFolder,
  });
  // The open list moves with Alt+Shift+↑ and Alt+Shift+↓.
  const [location, navigate] = useLocation();

  // Making, archiving and deleting lists and folders from the rows' menus.
  const [creating, setCreating] = useState<Creating | null>(null);
  const createList = useCreateList();
  const createFolder = useCreateFolder();
  const archive = useArchiveList();
  const removeList = useDeleteContainer("lists");
  const removeFolder = useDeleteContainer("folders");
  const fail = (e: Error) => toast.show({ message: e.message, error: true });
  const actions: SidebarActions = {
    creating,
    create: (what) => {
      // The field shows inside the folder, so open it if it was closed.
      if (what.parentId) {
        const details = ref.current?.querySelector<HTMLDetailsElement>(`details[data-folder="${CSS.escape(what.parentId)}"]`);
        if (details) details.open = true;
      }
      setCreating(what);
    },
    finishCreate: (name) => {
      const what = creating;
      setCreating(null);
      if (!what || !name) return;
      if (what.kind === "list") {
        createList.mutateAsync({ name, folderId: what.parentId }).then((made) => {
          navigate(`/list/${made.id}`);
          onNavigate();
        }, fail);
      } else {
        createFolder.mutateAsync({ name, parentId: what.parentId, ...(what.context ? { context: what.context } : {}) }).catch(fail);
      }
    },
    archiveList: (list) => {
      archive.mutateAsync({ id: list.id, archived: true }).then(() => {
        toast.show({ message: `Archived “${list.name}”`, undo: () => { archive.mutateAsync({ id: list.id, archived: false }).catch(fail); } });
      }, fail);
    },
    deleteList: (list) => {
      removeList.mutateAsync(list.id).then(() => {
        if (location === `/list/${list.id}`) navigate("/");
        toast.show({ message: `Deleted “${list.name}”` });
      }, fail);
    },
    deleteFolder: (folder) => {
      removeFolder.mutateAsync(folder.id).then(() => toast.show({ message: `Deleted “${folder.name}”` }), fail);
    },
  };
  const openList = location.match(/^\/list\/([^/]+)$/)?.[1];
  const step = (delta: 1 | -1) => () => {
    const to = openList && moveForStep(tree, openList, delta);
    if (to) move(openList, to);
  };
  useCommand("moveListUp", openList ? step(-1) : undefined);
  useCommand("moveListDown", openList ? step(1) : undefined);
  // ⌥J and ⌥K open the next or previous list as the sidebar shows them (the Inbox, then the context's lists,
  // skipping folders and lists in collapsed ones), wrapping at the ends. The list takes the keyboard, as any does.
  const revealCurrent = useRef(false);
  const stepList = (delta: 1 | -1) => () => {
    const hidden = (id: string) => Boolean(ref.current?.querySelector(`[data-list-row="${CSS.escape(id)}"]`)?.closest("details:not([open])"));
    const hrefs = [...(inboxId ? ["/inbox"] : []), ...listOrder(tree).filter((id) => !hidden(id)).map((id) => `/list/${id}`)];
    const next = hrefs[wrapIndex(hrefs.indexOf(location), hrefs.length, delta)];
    if (!next) return false;
    revealCurrent.current = true;
    navigate(next);
  };
  useCommand("nextList", stepList(1));
  useCommand("previousList", stepList(-1));
  useEffect(() => {
    if (!revealCurrent.current) return;
    revealCurrent.current = false;
    ref.current?.querySelector('.sidebar-scroll [aria-current="page"]')?.scrollIntoView?.({ block: "nearest" });
  }, [location]);
  // How many tasks each view shows in the context, counted by the server.
  const viewCounts = new Map((useViews(context).data ?? []).map((v) => [v.id, v.count]));

  return (
    <nav ref={ref} className="sidebar" aria-label="Sidebar" id="sidebar" onKeyDown={onKeyDown}>
      {CONTEXT_CHOICES.map((c) => <ContextCommand key={c.id} choice={c} onChoose={() => setContext(c.id)} />)}
      <div className="sidebar-brand"><Logo />Claudia</div>
      <div className="segmented" role="group" aria-label="Context">
        {CONTEXT_CHOICES.map((c) => (
          <button key={c.id} type="button" aria-pressed={context === c.id} onClick={() => setContext(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="sidebar-scroll" ref={drag.ref} onPointerDown={drag.onPointerDown}>
        <ul className="nav-list">
          <li><NavLink href="/dashboard" onNavigate={onNavigate}>Dashboard</NavLink></li>
          <li><NavLink href="/search" onNavigate={onNavigate}>Search</NavLink></li>
          <li><NavLink href="/labels" onNavigate={onNavigate}>Labels</NavLink></li>
          {VIEWS.filter((v) => v.id !== "inbox" || inboxId).map((v) => (
            <li key={v.id}>
              <NavLink href={`/${v.id}`} count={viewCounts.get(v.id)} onNavigate={onNavigate}
                dropList={v.id === "inbox" ? inboxId : undefined}>{v.name}</NavLink>
            </li>
          ))}
        </ul>

        {filters.length > 0 && (
          <section aria-labelledby="sidebar-filters">
            <h2 id="sidebar-filters" className="nav-heading">Filters</h2>
            <ul className="nav-list">
              {filters.map((f) => (
                <li key={f.id}><NavLink href={`/filter/${f.id}`} onNavigate={onNavigate}>{f.name}</NavLink></li>
              ))}
            </ul>
          </section>
        )}

        <ActionsContext.Provider value={actions}>
          <section aria-labelledby="sidebar-lists">
            <div className="nav-heading-row" data-folder-row="">
              <h2 id="sidebar-lists" className="nav-heading">Lists</h2>
              <ListsHeadingMenu context={context} />
            </div>
            <ul className="nav-list">
              {tree.lists.map((l) => (
                <li key={l.id} data-list-row={l.id}><ListLink list={l} counts={counts} onNavigate={onNavigate} /></li>
              ))}
              {isCreating(creating, "list", null) && <NewItemField kind="list" />}
              {tree.folders.map((f) => <FolderItem key={f.folder.id} node={f} counts={counts} onNavigate={onNavigate} />)}
              {isCreating(creating, "folder", null) && <NewItemField kind="folder" />}
            </ul>
          </section>
        </ActionsContext.Provider>
      </div>

      <footer className="sidebar-footer">
        <div className="segmented theme-switch" role="group" aria-label="Theme">
          {THEME_CHOICES.map((t) => (
            <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        {shakeable && (
          <label className="footer-switch">
            <input
              type="checkbox"
              role="switch"
              checked={shake}
              onChange={(e) => {
                const next = e.target.checked;
                void setShake(next).then((ok) => {
                  if (!ok) toast.show({ message: "Motion access wasn't allowed, so shaking can't undo. Reopen Claudia and try again.", error: true });
                });
              }}
            />
            Shake to undo
          </label>
        )}
        {/* The token's name and scopes only in the tooltip: on screen they read like a user name. */}
        <button
          type="button"
          className="quiet"
          title={state.status === "signedIn" ? `Signed in with the token “${state.me.name}” (${state.me.scopes.join(", ")})` : undefined}
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </footer>
    </nav>
  );
}
