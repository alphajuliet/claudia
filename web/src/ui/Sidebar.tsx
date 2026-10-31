import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useFilters, useFolders, useLists } from "../data/queries";
import { sidebarTree, type FolderNode } from "../lib/sidebar";
import { findInbox, VIEWS } from "../lib/views";
import { useSession } from "../session/SessionProvider";
import { CONTEXT_CHOICES, useContextFilter } from "./contextFilter";
import { THEME_CHOICES, useTheme } from "./theme";

function NavLink({ href, children, onNavigate }: { href: string; children: ReactNode; onNavigate: () => void }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Link href={href} className="nav-link" aria-current={current ? "page" : undefined} onClick={onNavigate}>
      {children}
    </Link>
  );
}

function FolderItem({ node, onNavigate }: { node: FolderNode; onNavigate: () => void }) {
  return (
    <li>
      <details open className="folder">
        <summary>{node.folder.name}</summary>
        <ul className="nav-list">
          {node.lists.map((l) => (
            <li key={l.id}><NavLink href={`/list/${l.id}`} onNavigate={onNavigate}>{l.name}</NavLink></li>
          ))}
          {node.folders.map((f) => <FolderItem key={f.folder.id} node={f} onNavigate={onNavigate} />)}
        </ul>
      </details>
    </li>
  );
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
  const { context, setContext } = useContextFilter();
  const folders = useFolders().data ?? [];
  const lists = useLists().data ?? [];
  const filters = [...(useFilters().data ?? [])].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const inboxId = findInbox(lists)?.id;
  // The Inbox list already shows as the Inbox view, so it stays out of the tree.
  const tree = sidebarTree(folders, lists.filter((l) => l.id !== inboxId), context);

  return (
    <nav ref={ref} className="sidebar" aria-label="Sidebar" id="sidebar" onKeyDown={onKeyDown}>
      <div className="segmented" role="group" aria-label="Context">
        {CONTEXT_CHOICES.map((c) => (
          <button key={c.id} type="button" aria-pressed={context === c.id} onClick={() => setContext(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="sidebar-scroll">
        <ul className="nav-list">
          <li><NavLink href="/search" onNavigate={onNavigate}>Search</NavLink></li>
          {VIEWS.filter((v) => v.id !== "inbox" || inboxId).map((v) => (
            <li key={v.id}><NavLink href={`/${v.id}`} onNavigate={onNavigate}>{v.name}</NavLink></li>
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

        {(tree.lists.length > 0 || tree.folders.length > 0) && (
          <section aria-labelledby="sidebar-lists">
            <h2 id="sidebar-lists" className="nav-heading">Lists</h2>
            <ul className="nav-list">
              {tree.lists.map((l) => (
                <li key={l.id}><NavLink href={`/list/${l.id}`} onNavigate={onNavigate}>{l.name}</NavLink></li>
              ))}
              {tree.folders.map((f) => <FolderItem key={f.folder.id} node={f} onNavigate={onNavigate} />)}
            </ul>
          </section>
        )}
      </div>

      <footer className="sidebar-footer">
        <div className="segmented theme-switch" role="group" aria-label="Theme">
          {THEME_CHOICES.map((t) => (
            <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        {state.status === "signedIn" && (
          <span className="who" title={`Signed in with the token “${state.me.name}”`}>
            <span className="who-name">{state.me.name}</span>
            <span className="who-scopes">{state.me.scopes.join(", ")}</span>
          </span>
        )}
        <button type="button" className="quiet" onClick={() => signOut()}>Sign out</button>
      </footer>
    </nav>
  );
}
