import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import { COMMANDS } from "../lib/commands";

const NAMES: Record<string, string> = { ArrowDown: "↓", ArrowUp: "↑", Escape: "Esc", Enter: "Enter" };

/** One binding as keycaps: "g i" reads "g then i". */
function Keys({ binding }: { binding: string }) {
  const keys = binding.split(" ");
  return (
    <>
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && " then "}
          <kbd>{NAMES[k] ?? k}</kbd>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Every command and its keys, over the app. It takes focus when it opens and gives it back when it closes
 * (Escape, Close or the backdrop).
 */
export function Shortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    ref.current?.focus();
    return () => { if (before instanceof HTMLElement && before.isConnected) before.focus(); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The overlay's keys are its own: nothing else runs while it's open, and Tab stays inside.
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      e.preventDefault();
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    }
  };

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="quiet small" onClick={onClose}>Close</button>
        </header>
        <table className="shortcuts-table">
          <tbody>
            {COMMANDS.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.label}</th>
                <td>
                  {c.keys.map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && " or "}
                      <Keys binding={k} />
                    </Fragment>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
