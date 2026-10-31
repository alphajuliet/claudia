export type CommandId =
  | "next" | "previous" | "collapse" | "expand" | "open" | "close" | "complete" | "rename" | "capture" | "search" | "help"
  | "goInbox" | "goToday" | "goNext" | "goWip" | "goWaiting" | "goSomeday";

export interface Command { id: CommandId; label: string; keys: string[] }

/**
 * Every command, in the order the shortcuts overlay lists them. Keys are `KeyboardEvent.key` values, and "g i" is a
 * chord (g, then i). Defaults follow Godspeed; user bindings from the `keymap` setting come with the keymap editor.
 */
export const COMMANDS: Command[] = [
  { id: "next", label: "Next task", keys: ["j", "ArrowDown"] },
  { id: "previous", label: "Previous task", keys: ["k", "ArrowUp"] },
  { id: "collapse", label: "Collapse, or go to the parent", keys: ["h"] },
  { id: "expand", label: "Expand", keys: ["l"] },
  { id: "open", label: "Open task details", keys: ["Enter", "o"] },
  { id: "close", label: "Close task details", keys: ["Escape"] },
  { id: "complete", label: "Complete task", keys: ["x"] },
  { id: "rename", label: "Rename task", keys: ["e"] },
  { id: "capture", label: "Add a task", keys: ["c"] },
  { id: "search", label: "Search", keys: ["/"] },
  { id: "goInbox", label: "Go to Inbox", keys: ["g i"] },
  { id: "goToday", label: "Go to Today", keys: ["g t"] },
  { id: "goNext", label: "Go to Next", keys: ["g n"] },
  { id: "goWip", label: "Go to WIP", keys: ["g w"] },
  { id: "goWaiting", label: "Go to Waiting", keys: ["g o"] },
  { id: "goSomeday", label: "Go to Someday", keys: ["g s"] },
  { id: "help", label: "Keyboard shortcuts", keys: ["?"] },
];
