import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useFolders, useLists } from "../data/queries";
import { wrapIndex } from "../lib/keymap";
import { listChoices, matchLists, type ListChoice } from "../lib/listSearch";

/**
 * Picks a list by typing part of its name: to go to it (`g l`) or to move a task there (`e m`, which leaves out
 * the task's own list as `exclude`). ↑ and ↓ choose, Enter picks, and Escape or the backdrop closes it, giving
 * focus back. It searches every list, whatever the context, and leaves the context as it is.
 */
export function ListPicker({ title = "Go to a list", exclude, onPick, onClose }: {
  title?: string;
  exclude?: string;
  onPick: (choice: ListChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listbox = useRef<HTMLUListElement>(null);
  const id = useId();
  const matches = matchLists(listChoices(useFolders().data ?? [], useLists().data ?? []).filter((c) => c.id !== exclude), query);
  const current = Math.min(active, matches.length - 1);
  const optionId = (i: number) => `${id}-${i}`;

  useEffect(() => {
    const before = document.activeElement;
    input.current?.focus();
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus(); };
  }, []);
  useEffect(() => {
    listbox.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [current, query]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Its keys are its own: nothing else runs while it's open.
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, wrapIndex(current, matches.length, e.key === "ArrowDown" ? 1 : -1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[current];
      if (match) onPick(match);
    }
  };

  // On the body, so a panel it opens from doesn't clip or place it.
  return createPortal(
    <div className="overlay list-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="list-picker" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="List name"
          aria-expanded="true"
          aria-controls={`${id}-lists`}
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? optionId(current) : undefined}
          placeholder={title}
          autoComplete="off"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        />
        <ul ref={listbox} id={`${id}-lists`} role="listbox" aria-label="Lists">
          {matches.map((m, i) => (
            <li key={m.id} id={optionId(i)} role="option" aria-selected={i === current} onMouseMove={() => setActive(i)} onClick={() => onPick(m)}>
              <span className="list-picker-name">{m.name}</span>
              {m.path && <span className="list-picker-path">{m.path}</span>}
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className="list-picker-empty">No matching lists.</p>}
      </div>
    </div>,
    document.body,
  );
}
