import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useCommand } from "./keyboard";
import { useLabelColour } from "./LabelChip";

/** Labels to offer: those not on the task whose names contain the typed text (ignoring case), alphabetically. */
export function labelOptions(all: string[], taken: string[], text: string): string[] {
  const has = new Set(taken.map((l) => l.toLowerCase()));
  const needle = text.trim().replace(/^#/, "").toLowerCase();
  return all
    .filter((l) => !has.has(l.toLowerCase()) && l.toLowerCase().includes(needle))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * The "Add a label" field: an accessible combobox whose list shows the labels not yet on the task. Focusing or tapping
 * the field opens it and typing filters it. A click or tap on a label adds it and leaves the list open for another;
 * Enter adds the highlighted label, or else the typed name. A name that isn't a label yet gets a last option to create
 * it. Escape closes an open list and goes no further, so the panel stays; with the list closed it reaches the panel.
 */
export function LabelPicker({ all, taken, onAdd }: {
  all: string[];
  taken: string[];
  /** Adds a name (already trimmed, without a leading #). False when it fails: the name goes back in the field. */
  onAdd: (name: string) => Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const name = text.trim().replace(/^#/, "");
  const matches = labelOptions(all, taken, text);
  const known = [...all, ...taken].some((l) => l.toLowerCase() === name.toLowerCase());
  const options = name && !known ? [...matches, name] : matches;
  const creates = (i: number) => i === matches.length && options.length > matches.length;
  const expanded = open && options.length > 0;
  const optionId = (i: number) => `${id}-${i}`;
  const list = useRef<HTMLUListElement>(null);
  const colourOf = useLabelColour();
  const input = useRef<HTMLInputElement>(null);
  // e l: into the field, which opens the list.
  useCommand("editLabels", () => { input.current?.focus({ preventScroll: true }); });
  // On a phone the list may open below the keyboard: bring it into view, and keep the highlighted option in view.
  useEffect(() => {
    if (expanded) list.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  useEffect(() => {
    if (expanded && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  const pick = (value: string) => {
    if (!value) return;
    // Typed in another case, an existing label keeps its own.
    const label = all.find((l) => l.toLowerCase() === value.toLowerCase()) ?? value;
    void onAdd(label).then((ok) => { if (!ok) setText((now) => now || label); });
    setText("");
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!expanded) { setOpen(true); setActive(e.key === "ArrowDown" ? 0 : options.length - 1); return; }
      // Past either end goes back to the typed text, then round again.
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => { const next = i + step; return next < -1 ? options.length - 1 : next >= options.length ? -1 : next; });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(expanded && active >= 0 ? options[active]! : name);
    } else if (e.key === "Escape" && expanded) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="label-picker">
      <input
        ref={input}
        type="text"
        className="detail-inline-input"
        role="combobox"
        aria-label="Add a label"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        placeholder="Add a label"
        autoComplete="off"
        autoCapitalize="off"
        enterKeyHint="done"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => { setOpen(false); setActive(-1); pick(name); }}
      />
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Labels" className="label-options" hidden={!expanded}
        // A press anywhere in the list (an option, the gaps, its scroll bar) keeps focus in the field, so the list stays
        // open and blur doesn't add the typed text as well.
        onMouseDown={(e) => e.preventDefault()}>
        {expanded && options.map((option, i) => (
          <li
            key={creates(i) ? `\u0000${option}` : option}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={creates(i) ? "label-option create" : "label-option"}
            onClick={() => pick(option)}
          >
            {creates(i) ? `Create “${option}”` : (
              <>
                {/* Its colour, as a dot; grey ones get the plain dot. */}
                <span className="label-dot" data-color={colourOf(option)} aria-hidden="true" />
                {option}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
