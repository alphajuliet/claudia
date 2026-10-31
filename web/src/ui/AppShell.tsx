import { useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import { ContextFilterProvider } from "./contextFilter";
import { FilterScreen, ListScreen, NotFound, ViewScreen } from "./screens";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";

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
      <ToastProvider>
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
              <Route path="/list/:id">{(p) => <ListScreen id={p.id} />}</Route>
              <Route path="/filter/:id">{(p) => <FilterScreen id={p.id} />}</Route>
              <Route path="/:view">{(p) => <ViewScreen id={p.view} />}</Route>
              <Route><NotFound /></Route>
            </Switch>
          </main>
        </div>
      </ToastProvider>
    </ContextFilterProvider>
  );
}
