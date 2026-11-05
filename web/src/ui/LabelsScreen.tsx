import { useRef, useState, type FormEvent } from "react";
import type { Label, LabelColour } from "@claudia/shared";
import { useCounts, useLabelChanges, useLabels } from "../data/queries";
import { PALETTE } from "../lib/labelColours";
import { InlineRename } from "./InlineRename";
import { useCommand } from "./keyboard";
import { LabelChip } from "./LabelChip";
import { useToast } from "./Toast";

const byName = (a: Label, b: Label) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** "12 open tasks", "1 open task" or "No open tasks". */
export function openTasks(n: number) {
  return n === 0 ? "No open tasks" : `${n} open task${n === 1 ? "" : "s"}`;
}

/**
 * Every label, alphabetically: add one, rename it (click its chip, or e t), pick its colour from the palette and
 * delete it (Delete or Backspace), which takes it off every task. Each row shows how many open tasks carry it.
 * j and k move between rows.
 */
export function LabelsScreen() {
  const labels = useLabels();
  const counts = useCounts().data;
  const { create, update, remove } = useLabelChanges();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // Each row's way into renaming, so e t can start it on the focused row.
  const starts = useRef(new Map<string, () => void>());

  const sorted = [...(labels.data ?? [])].sort(byName);
  const countOf = (name: string) =>
    Object.values(counts?.lists ?? {}).reduce((n, c) => n + (c.labels[name.toLowerCase()] ?? 0), 0);
  const report = (e: Error) => toast.show({ message: e.message, error: true });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim().replace(/^#/, "");
    if (!name) return;
    create.mutateAsync({ name }).then(() => setDraft(""), report);
  };
  const rename = (label: Label, name: string) => update.mutateAsync({ id: label.id, name }).catch(report);
  const recolour = (label: Label, color: LabelColour | null) => {
    setPicking(null);
    if (color !== label.color) update.mutateAsync({ id: label.id, color }).catch(report);
    rowOf(label.id)?.focus();
  };
  const del = (label: Label) => {
    const n = countOf(label.name);
    const on = n === 0 ? "" : ` It comes off ${n === 1 ? "the 1 open task that has it" : `all ${n} open tasks that have it`}, and any completed ones.`;
    if (!window.confirm(`Delete the label “${label.name}”?${on} This can't be undone.`)) return;
    // Focus goes to the next row, or the one before when it was the last.
    const at = sorted.findIndex((l) => l.id === label.id);
    const after = sorted[at + 1] ?? sorted[at - 1];
    remove.mutateAsync(label.id).catch(report);
    if (after) requestAnimationFrame(() => rowOf(after.id)?.focus());
  };

  const rowOf = (id: string) => list.current?.querySelector<HTMLElement>(`[data-label-id="${id}"]`);
  /** The label whose row has focus (or holds it), if any. */
  const focused = () => {
    const row = (document.activeElement as Element | null)?.closest<HTMLElement>("[data-label-id]");
    return row && list.current?.contains(row) ? sorted.find((l) => l.id === row.dataset.labelId) : undefined;
  };
  const step = (delta: 1 | -1) => () => {
    const at = sorted.findIndex((l) => l.id === focused()?.id);
    const to = sorted[at < 0 ? (delta === 1 ? 0 : sorted.length - 1) : Math.min(Math.max(at + delta, 0), sorted.length - 1)];
    if (to) rowOf(to.id)?.focus();
  };
  useCommand("next", step(1));
  useCommand("previous", step(-1));
  useCommand("rename", () => {
    const label = focused();
    if (!label) return false;
    starts.current.get(label.id)?.();
  });
  useCommand("delete", () => {
    const label = focused();
    if (!label) return false;
    del(label);
  });

  return (
    <div className="labels-screen">
      <header className="screen-header">
        <h1>Labels</h1>
      </header>
      <form className="label-new" onSubmit={add}>
        <input
          type="text"
          aria-label="New label"
          placeholder="New label"
          autoComplete="off"
          enterKeyHint="done"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim() || create.isPending}>Add</button>
      </form>

      {labels.isPending ? (
        <p className="muted">Loading…</p>
      ) : labels.error ? (
        <div role="alert">
          <p>{labels.error.message}</p>
          <button type="button" className="quiet small" onClick={() => labels.refetch()}>Try again</button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="muted">No labels yet. Add one above, or with #name in quick add.</p>
      ) : (
        <ul ref={list} className="label-rows" aria-label="Labels">
          {sorted.map((label) => (
            <li key={label.id} className="label-row" tabIndex={-1} data-label-id={label.id}>
              <div className="label-row-main">
                <InlineRename name={label.name} label={`Name of ${label.name}`} className="label-rename" onRename={(name) => void rename(label, name)}>
                  {(start) => {
                    starts.current.set(label.id, start);
                    return (
                      <button type="button" className="label-name-button" title="Click to rename" onClick={start}>
                        <LabelChip name={label.name} color={label.color} />
                        <span className="sr-only">, rename</span>
                      </button>
                    );
                  }}
                </InlineRename>
                <span className="label-count muted">{openTasks(countOf(label.name))}</span>
                <button
                  type="button"
                  className="quiet small label-colour-button"
                  aria-expanded={picking === label.id}
                  aria-label={`Colour for ${label.name}: ${PALETTE.find((p) => p.id === label.color)?.name ?? "Default"}`}
                  onClick={() => setPicking((p) => (p === label.id ? null : label.id))}
                >
                  <span className="label-dot" data-color={label.color ?? undefined} aria-hidden="true" />
                  Colour
                </button>
                <button type="button" className="quiet small danger" aria-label={`Delete ${label.name}`} onClick={() => del(label)}>
                  Delete
                </button>
              </div>
              {picking === label.id && (
                <Swatches
                  label={label}
                  onPick={(color) => recolour(label, color)}
                  onClose={() => { setPicking(null); rowOf(label.id)?.focus(); }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Default (grey) and the 16 palette colours, the current one pressed. Escape closes without a change. */
function Swatches({ label, onPick, onClose }: { label: Label; onPick: (color: LabelColour | null) => void; onClose: () => void }) {
  const choices: { id: LabelColour | null; name: string }[] = [{ id: null, name: "Default" }, ...PALETTE];
  return (
    <div
      className="swatches"
      role="group"
      aria-label={`Colours for ${label.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }
      }}
    >
      {choices.map((c) => (
        <button
          key={c.id ?? "default"}
          type="button"
          className="swatch"
          aria-pressed={c.id === label.color}
          title={c.name}
          // Into the grid at the current colour, so the keyboard starts there.
          autoFocus={c.id === label.color}
          onClick={() => onPick(c.id)}
        >
          <LabelChip name={c.name} color={c.id} />
        </button>
      ))}
    </div>
  );
}
