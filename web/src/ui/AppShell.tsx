import { useEffect, useRef, useState } from "react";
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
import { focusTask } from "./TaskList";
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
  const [location, navigate] = useLocation();
  const menu = useRef<HTMLButtonElement>(null);
  const close = () => setDrawerOpen(false);
  // Leaving the drawer with Escape or the backdrop returns focus to Menu.
  const dismissDrawer = () => {
    setDrawerOpen(false);
    menu.current?.focus();
  };

  // On the search screen, `/` is the screen's own (it focuses the field).
  useCommand("search", () => (location === "/search" ? false : navigate("/search")));
  useCommand("help", () => setHelpOpen(true));
  // Closing the panel puts focus back on the task's row, so the keyboard carries on from there.
  const closePanel = () => {
    const closed = selectedId;
    select(null);
    if (closed) focusTask(closed);
  };
  useCommand("close", drawerOpen ? dismissDrawer : selectedId ? closePanel : undefined);
  // The open drawer covers the list, so the list's keys wait until it closes. Registered as the drawer opens, these
  // come after the list's own and so are tried first. (Enter stays free for the drawer's links.)
  const covered = drawerOpen ? () => {} : undefined;
  useCommand("next", covered);
  useCommand("collapse", covered);
  useCommand("expand", covered);
  useCommand("previous", covered);
  useCommand("complete", covered);
  useCommand("rename", covered);
  useCommand("delete", covered);
  useCommand("toggleCompleted", covered);
  useCommand("capture", covered);

  // Going anywhere (a link, a g chord, search) closes the drawer.
  useEffect(() => setDrawerOpen(false), [location]);


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
            <button ref={menu} type="button" className="quiet" aria-expanded={drawerOpen} aria-controls="sidebar" onClick={() => setDrawerOpen((o) => !o)}>
              Menu
            </button>
            <span className="topbar-title">Claudia</span>
          </header>
          <Sidebar onNavigate={close} drawerOpen={drawerOpen} onCloseDrawer={dismissDrawer} />
          {drawerOpen && <div className="backdrop" aria-hidden="true" onClick={dismissDrawer} />}
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
          {selectedId && <TaskDetail key={selectedId} id={selectedId} onClose={closePanel} />}
          {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
          {GO.map(([id, to]) => <GoCommand key={id} id={id} to={to} />)}
        </div>
      </ToastProvider>
    </ContextFilterProvider>
  );
}
