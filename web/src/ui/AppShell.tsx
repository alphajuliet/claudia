import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import type { CommandId } from "../lib/commands";
import { ContextFilterProvider } from "./contextFilter";
import { KeyboardProvider, useCommand } from "./keyboard";
import { FilterScreen, Home, ListScreen, NotFound, ViewScreen } from "./screens";
import { SearchScreen } from "./SearchScreen";
import { useSelectedTask } from "./selection";
import { Shortcuts } from "./Shortcuts";
import { Sidebar } from "./Sidebar";
import { TaskDetail } from "./TaskDetail";
import { ToastProvider } from "./Toast";

const GO: [CommandId, string][] = [
  ["goInbox", "/inbox"], ["goToday", "/today"], ["goNext", "/next"], ["goWip", "/wip"], ["goWaiting", "/waiting"], ["goSomeday", "/someday"],
];

/** A `g` chord: go to a view. */
function GoCommand({ id, to }: { id: CommandId; to: string }) {
  const [, navigate] = useLocation();
  useCommand(id, () => navigate(to));
  return null;
}

/**
 * The signed-in app: sidebar on the left, the current route's content beside it, and the selected task's details
 * (`?task=<id>`) on the right. Every key goes through the keyboard commands.
 */
export function AppShell() {
  return (
    <KeyboardProvider>
      <Shell />
    </KeyboardProvider>
  );
}

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { selectedId, select } = useSelectedTask();
  const [, navigate] = useLocation();
  const close = () => setDrawerOpen(false);

  useCommand("search", () => navigate("/search"));
  useCommand("help", () => setHelpOpen(true));
  useCommand("close", selectedId ? () => select(null) : undefined);

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
              <Route path="/search"><SearchScreen /></Route>
              <Route path="/:view">{(p) => <ViewScreen id={p.view} />}</Route>
              <Route><NotFound /></Route>
            </Switch>
          </main>
          {selectedId && <TaskDetail key={selectedId} id={selectedId} onClose={() => select(null)} />}
          {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
          {GO.map(([id, to]) => <GoCommand key={id} id={id} to={to} />)}
        </div>
      </ToastProvider>
    </ContextFilterProvider>
  );
}
