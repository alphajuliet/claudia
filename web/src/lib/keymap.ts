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

/** The keys bound with Alt ("ArrowUp" for "Alt+ArrowUp" and "Alt+Shift+ArrowUp"): with Alt, only these are ours. */
const ALT_KEYS = new Set(COMMANDS.flatMap((c) => c.keys).filter((k) => k.startsWith("Alt+")).map((k) => k.split("+").at(-1)!));

/** The keys bound with Ctrl or ⌘ ("Mod+f"): the only ones with those held that are ours, even in a text field. */
const MOD_KEYS = new Set(COMMANDS.flatMap((c) => c.keys).filter((k) => k.startsWith("Mod+")));

/** A key press as the bindings name it. */
interface Press { altKey: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; key: string; code?: string }

/**
 * The key a press is, without Alt: on a Mac ⌥J types "∆", so with Alt a letter key is read from `code` ("KeyJ" is
 * "j", or "J" with Shift).
 */
function baseKey(e: Press): string {
  const letter = e.altKey && e.code?.match(/^Key([A-Z])$/)?.[1];
  if (letter) return e.shiftKey ? letter : letter.toLowerCase();
  return e.key;
}

/**
 * The binding name of a press: "j", "J", "Alt+j", "Alt+ArrowUp" or "Alt+Shift+ArrowUp". Caps Lock gives capitals
 * without Shift, so those read as the lower-case key (Shift+C stays C). Shift is part of a printable key already,
 * so it only shows for the likes of the arrows.
 */
export function keyName(e: Press): string {
  // Ctrl (or ⌘ on a Mac) alone is "Mod": "Mod+f".
  if ((e.ctrlKey || e.metaKey) && !(e.ctrlKey && e.metaKey) && !e.altKey) return `Mod+${e.key.length === 1 && !e.shiftKey ? e.key.toLowerCase() : e.key}`;
  const key = baseKey(e);
  const base = key.length === 1 && !e.shiftKey ? key.toLowerCase() : key;
  return e.altKey ? `Alt+${e.shiftKey && key.length > 1 ? "Shift+" : ""}${base}` : base;
}

/**
 * True when a key press belongs to the browser or a field: Ctrl or ⌘ held (unless bound, like ⌘F), Alt held with a key no command binds
 * with it, or typing in a text field.
 */
export function ignoresKeys(e: Press & { ctrlKey: boolean; metaKey: boolean; target: EventTarget | null }): boolean {
  if (e.ctrlKey || e.metaKey) return !MOD_KEYS.has(keyName(e));
  if (e.altKey && !ALT_KEYS.has(baseKey(e))) return true;
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
