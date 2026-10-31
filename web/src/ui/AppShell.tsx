import { useEffect, useState } from "react";
import { Link, Redirect, Route, Switch } from "wouter";
import { useFilters, useLists } from "../data/queries";
import { VIEWS } from "../lib/views";
import { ContextFilterProvider } from "./contextFilter";
import { Sidebar } from "./Sidebar";

// Route content is a stub heading for now; the task lists come next.
function ViewRoute({ id }: { id: string }) {
  const view = VIEWS.find((v) => v.id === id);
  if (!view) return <NotFound />;
  return <h1>{view.name}</h1>;
}

function ListRoute({ id }: { id: string }) {
  const { data } = useLists();
  return <h1>{data?.find((l) => l.id === id)?.name ?? "List"}</h1>;
}

function FilterRoute({ id }: { id: string }) {
  const { data } = useFilters();
  return <h1>{data?.find((f) => f.id === id)?.name ?? "Filter"}</h1>;
}

function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">There's nothing at this address.</p>
      <p><Link href="/inbox">Go to Inbox</Link></p>
    </>
  );
}

/** The signed-in app: sidebar on the left, the current route's content beside it. */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const close = () => setDrawerOpen(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <ContextFilterProvider>
      <div className={drawerOpen ? "shell drawer-open" : "shell"}>
        <header className="topbar">
          <button type="button" className="quiet" aria-expanded={drawerOpen} aria-controls="sidebar" onClick={() => setDrawerOpen((o) => !o)}>
            Menu
          </button>
          <span className="topbar-title">Claudia</span>
        </header>
        <Sidebar onNavigate={close} />
        {drawerOpen && <div className="backdrop" aria-hidden="true" onClick={close} />}
        <main className="content">
          <Switch>
            <Route path="/"><Redirect to="/inbox" replace /></Route>
            <Route path="/list/:id">{(p) => <ListRoute id={p.id} />}</Route>
            <Route path="/filter/:id">{(p) => <FilterRoute id={p.id} />}</Route>
            <Route path="/:view">{(p) => <ViewRoute id={p.view} />}</Route>
            <Route><NotFound /></Route>
          </Switch>
        </main>
      </div>
    </ContextFilterProvider>
  );
}
