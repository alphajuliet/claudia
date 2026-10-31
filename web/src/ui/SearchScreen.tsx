import { useEffect, useState, type KeyboardEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { useTasks } from "../data/queries";
import { useGroupedSections } from "./screens";
import { TaskList } from "./TaskList";

const DELAY_MS = 250;

/**
 * Open tasks whose title or notes match, grouped by list as in views. The words live in the address (`?q=`),
 * updated a moment after typing stops, so reload and back keep the search.
 */
export function SearchScreen() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const q = new URLSearchParams(search).get("q") ?? "";
  const [text, setText] = useState(q);

  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(search);
      if (text.trim()) next.set("q", text.trim());
      else next.delete("q");
      const query = next.toString();
      navigate(query ? `${path}?${query}` : path, { replace: true });
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, q, search, path, navigate]);

  const tasks = useTasks(q ? new URLSearchParams({ status: "open", limit: "500", q }).toString() : null);
  const sections = useGroupedSections(tasks.data);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
  };

  return (
    <>
      <h1>Search</h1>
      <div className="quick-add">
        <input
          type="search"
          className="quick-add-input"
          aria-label="Search"
          placeholder="Search titles and notes"
          autoComplete="off"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {q ? (
        <TaskList query={tasks} sections={sections} empty="No open tasks match." />
      ) : (
        <p className="list-state muted">Type to search titles and notes.</p>
      )}
    </>
  );
}
