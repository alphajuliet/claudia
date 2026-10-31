import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRename } from "../data/queries";
import { useToast } from "./Toast";

/** Renames a list or folder, reporting a failure in the toast (the old name comes back). */
export function useRenameReported(kind: "lists" | "folders") {
  const rename = useRename(kind);
  const toast = useToast();
  return (id: string, name: string) => {
    rename.mutateAsync({ id, name }).catch((e: Error) => toast.show({ message: e.message, error: true }));
  };
}

/**
 * A name that turns into a text field in place: Enter or leaving the field saves a changed, non-empty name through
 * `onRename`; Escape cancels. `children(start)` renders the name and decides what starts editing.
 */
export function InlineRename({ name, label, className, onRename, children }: {
  name: string;
  label: string;
  className?: string;
  onRename: (name: string) => void;
  children: (start: () => void) => ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (draft === null) {
    return children(() => {
      done.current = false;
      setDraft(name);
    });
  }
  const finish = (save: boolean) => {
    // Enter or Escape unmounts the field, which may also fire blur: act once.
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (save && next && next !== name) onRename(next);
    setDraft(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  };
  return (
    <input
      ref={input}
      type="text"
      className={["inline-rename", className].filter(Boolean).join(" ")}
      aria-label={label}
      autoFocus
      autoComplete="off"
      enterKeyHint="done"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      // Inside a folder's <summary>, clicks and Space would open or close the folder.
      onClick={(e) => e.preventDefault()}
      onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
    />
  );
}
