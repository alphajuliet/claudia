import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useFolders, useLists } from "../data/queries";
import { wrapIndex } from "../lib/keymap";
import { listChoices, matchLists } from "../lib/listSearch";

/**
 * Jumps to a list by typing part of its name. ↑ and ↓ choose, Enter goes, and Escape or the backdrop closes it, giving
 * focus back. It searches every list, whatever the context, and leaves the context as it is.
 */
export function ListPicker({ onGo, onClose }: { onGo: (href: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listbox = useRef<HTMLUListElement>(null);
  const id = useId();
  const matches = matchLists(listChoices(useFolders().data ?? [], useLists().data ?? []), query);
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
      if (match) onGo(match.href);
    }
  };

  return (
    <div className="overlay list-picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="list-picker" role="dialog" aria-modal="true" aria-label="Go to a list" onKeyDown={onKeyDown}>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="List name"
          aria-expanded="true"
          aria-controls={`${id}-lists`}
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? optionId(current) : undefined}
          placeholder="Go to a list"
          autoComplete="off"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        />
        <ul ref={listbox} id={`${id}-lists`} role="listbox" aria-label="Lists">
          {matches.map((m, i) => (
            <li key={m.id} id={optionId(i)} role="option" aria-selected={i === current} onMouseMove={() => setActive(i)} onClick={() => onGo(m.href)}>
              <span className="list-picker-name">{m.name}</span>
              {m.path && <span className="list-picker-path">{m.path}</span>}
            </li>
          ))}
        </ul>
        {matches.length === 0 && <p className="list-picker-empty">No matching lists.</p>}
      </div>
    </div>
  );
}
