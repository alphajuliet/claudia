import { useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import { ContextFilterProvider } from "./contextFilter";
import { FilterScreen, Home, ListScreen, NotFound, ViewScreen } from "./screens";
import { useSelectedTask } from "./selection";
import { Sidebar } from "./Sidebar";
import { TaskDetail } from "./TaskDetail";
import { ToastProvider } from "./Toast";

/**
 * The signed-in app: sidebar on the left, the current route's content beside it, and the selected task's details
 * (`?task=<id>`) on the right.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { selectedId, select } = useSelectedTask();
  const close = () => setDrawerOpen(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // The drawer is for narrow screens: close it when the window widens to the desktop layout.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 900px)");
    const onChange = (e: { matches: boolean }) => { if (e.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <ContextFilterProvider>
      <ToastProvider>
        <div className={["shell", drawerOpen && "drawer-open", selectedId && "detail-open"].filter(Boolean).join(" ")}>
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
              <Route path="/"><Home /></Route>
              <Route path="/list/:id">{(p) => <ListScreen id={p.id} />}</Route>
              <Route path="/filter/:id">{(p) => <FilterScreen id={p.id} />}</Route>
              <Route path="/:view">{(p) => <ViewScreen id={p.view} />}</Route>
              <Route><NotFound /></Route>
            </Switch>
          </main>
          {selectedId && <TaskDetail key={selectedId} id={selectedId} onClose={() => select(null)} />}
        </div>
      </ToastProvider>
    </ContextFilterProvider>
  );
}
