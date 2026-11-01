export type CommandId =
  | "next" | "previous" | "moveUp" | "moveDown" | "indent" | "outdent" | "moveListUp" | "moveListDown" | "collapse" | "expand" | "open" | "close" | "complete" | "rename" | "delete" | "toggleCompleted" | "capture" | "search" | "help"
  | "contextAll" | "contextWork" | "contextPersonal" | "contextHome"
  | "goList" | "goDashboard" | "goInbox" | "goToday" | "goNext" | "goWip" | "goWaiting" | "goSomeday";

export interface Command { id: CommandId; label: string; keys: string[] }

/**
 * Every command, in the order the shortcuts overlay lists them. Keys are `KeyboardEvent.key` values, "g i" is a
 * chord (g, then i) and "Alt+ArrowUp" is ArrowUp with Alt (⌥) held ("Alt+Shift+ArrowUp" with Shift too). Defaults follow Godspeed; user bindings from the `keymap` setting come with the keymap editor.
 */
export const COMMANDS: Command[] = [
  { id: "next", label: "Next task", keys: ["j", "ArrowDown"] },
  { id: "previous", label: "Previous task", keys: ["k", "ArrowUp"] },
  { id: "moveUp", label: "Move task up", keys: ["K", "Alt+ArrowUp"] },
  { id: "moveDown", label: "Move task down", keys: ["J", "Alt+ArrowDown"] },
  { id: "indent", label: "Indent task under the one above", keys: ["L"] },
  { id: "outdent", label: "Outdent task", keys: ["H"] },
  { id: "moveListUp", label: "Move list up", keys: ["Alt+Shift+ArrowUp"] },
  { id: "moveListDown", label: "Move list down", keys: ["Alt+Shift+ArrowDown"] },
  { id: "collapse", label: "Collapse, or go to the parent", keys: ["h"] },
  { id: "expand", label: "Expand", keys: ["l"] },
  { id: "open", label: "Open task details", keys: ["Enter", "o"] },
  { id: "close", label: "Close task details", keys: ["Escape"] },
  { id: "complete", label: "Complete task", keys: ["x"] },
  { id: "rename", label: "Rename task", keys: ["e"] },
  { id: "delete", label: "Delete task", keys: ["Delete", "Backspace"] },
  { id: "toggleCompleted", label: "Show or hide completed tasks", keys: ["C"] },
  { id: "capture", label: "Add a task", keys: ["c"] },
  { id: "search", label: "Search", keys: ["/"] },
  { id: "contextAll", label: "Show all contexts", keys: ["1"] },
  { id: "contextWork", label: "Show Work", keys: ["2"] },
  { id: "contextPersonal", label: "Show Personal", keys: ["3"] },
  { id: "contextHome", label: "Show Home", keys: ["4"] },
  { id: "goList", label: "Go to a list", keys: ["g l"] },
  { id: "goDashboard", label: "Go to Dashboard", keys: ["g d"] },
  { id: "goInbox", label: "Go to Inbox", keys: ["g i"] },
  { id: "goToday", label: "Go to Today", keys: ["g t"] },
  { id: "goNext", label: "Go to Next", keys: ["g n"] },
  { id: "goWip", label: "Go to WIP", keys: ["g w"] },
  { id: "goWaiting", label: "Go to Waiting", keys: ["g o"] },
  { id: "goSomeday", label: "Go to Someday", keys: ["g s"] },
  { id: "help", label: "Keyboard shortcuts", keys: ["?"] },
];
