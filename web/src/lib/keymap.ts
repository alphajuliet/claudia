import { COMMANDS, type Command, type CommandId } from "./commands";

/**
 * Matches keys to commands, one key at a time. A key that starts a chord gives "pending"; the next key within
 * `chordMs` completes the chord, and any other key cancels it (without running its own binding). After the
 * timeout the chord is forgotten and the key is matched on its own.
 */
export function createMatcher(commands: Command[], chordMs = 1500) {
  const bindings = new Map<string, CommandId>();
  const prefixes = new Set<string>();
  for (const c of commands) {
    for (const k of c.keys) {
      bindings.set(k, c.id);
      const [first, second] = k.split(" ");
      if (second) prefixes.add(first!);
    }
  }
  let pending: { key: string; at: number } | null = null;
  return {
    /** Forgets a half-typed chord (a key went elsewhere in between). */
    reset() {
      pending = null;
    },
    match(key: string, now: number): CommandId | "pending" | null {
      if (pending && now - pending.at <= chordMs) {
        const chord = `${pending.key} ${key}`;
        pending = null;
        return bindings.get(chord) ?? null;
      }
      pending = null;
      if (prefixes.has(key)) {
        pending = { key, at: now };
        return "pending";
      }
      return bindings.get(key) ?? null;
    },
  };
}

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** The keys bound with Alt ("ArrowUp" for "Alt+ArrowUp"): with Alt, only these are ours. */
const ALT_KEYS = new Set(COMMANDS.flatMap((c) => c.keys).filter((k) => k.startsWith("Alt+")).map((k) => k.slice(4)));

/**
 * True when a key press belongs to the browser or a field: Ctrl or ⌘ held, Alt held with a key no command binds
 * with it, or typing in a text field.
 */
export function ignoresKeys(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string; target: EventTarget | null }): boolean {
  if (e.ctrlKey || e.metaKey || (e.altKey && !ALT_KEYS.has(e.key))) return true;
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement) return !NOT_TEXT.has(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable === true;
}

/** The index one step on from `current` (-1 for none), wrapping at both ends; -1 when there's nothing. */
export function wrapIndex(current: number, length: number, delta: 1 | -1): number {
  if (length === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
