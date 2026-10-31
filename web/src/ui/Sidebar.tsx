import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useFilters, useFolders, useLists } from "../data/queries";
import { sidebarTree, type FolderNode } from "../lib/sidebar";
import { findInbox, VIEWS } from "../lib/views";
import { useSession } from "../session/SessionProvider";
import { CONTEXT_CHOICES, useContextFilter } from "./contextFilter";

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

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { state, signOut } = useSession();
  const { context, setContext } = useContextFilter();
  const folders = useFolders().data ?? [];
  const lists = useLists().data ?? [];
  const filters = [...(useFilters().data ?? [])].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const inboxId = findInbox(lists)?.id;
  // The Inbox list already shows as the Inbox view, so it stays out of the tree.
  const tree = sidebarTree(folders, lists.filter((l) => l.id !== inboxId), context);

  return (
    <nav className="sidebar" aria-label="Sidebar" id="sidebar">
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
