export type CommandId =
  | "next" | "previous" | "newTask" | "newSubtask" | "newHeading" | "moveUp" | "moveDown" | "indent" | "outdent" | "moveListUp" | "moveListDown" | "collapse" | "expand" | "open" | "close" | "complete" | "priorityHigh" | "priorityNormal" | "priorityLow" | "rename" | "editNotes" | "editLabels" | "moveToList" | "delete" | "toggleCompleted" | "undo" | "capture" | "search" | "help"
  | "contextAll" | "contextWork" | "contextPersonal" | "contextHome"
  | "nextList" | "previousList" | "goList" | "goTaskList" | "goDashboard" | "goLabels" | "goInbox" | "goToday" | "goNext" | "goWip" | "goWaiting" | "goSomeday";

export interface Command { id: CommandId; label: string; keys: string[] }

/**
 * Every command, in the order the shortcuts overlay lists them. Keys are `KeyboardEvent.key` values, "g i" is a
 * chord (g, then i) and "Alt+ArrowUp" is ArrowUp with Alt (⌥) held ("Alt+Shift+ArrowUp" with Shift too). Defaults follow Godspeed; user bindings from the `keymap` setting come with the keymap editor.
 */
export const COMMANDS: Command[] = [
  { id: "next", label: "Next task", keys: ["j", "ArrowDown"] },
  { id: "previous", label: "Previous task", keys: ["k", "ArrowUp"] },
  { id: "newTask", label: "New task after this one", keys: ["n t"] },
  { id: "newSubtask", label: "New subtask of this task", keys: ["n s"] },
  { id: "newHeading", label: "New heading in this list", keys: ["n h"] },
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
  { id: "priorityHigh", label: "Set priority to High", keys: ["p h"] },
  { id: "priorityNormal", label: "Set priority to Normal", keys: ["p n"] },
  { id: "priorityLow", label: "Set priority to Low", keys: ["p l"] },
  { id: "rename", label: "Edit title", keys: ["e t"] },
  { id: "editNotes", label: "Edit notes in the task details", keys: ["e n"] },
  { id: "editLabels", label: "Add a label in the task details", keys: ["e l"] },
  { id: "moveToList", label: "Move task to another list", keys: ["e m"] },
  { id: "delete", label: "Delete task", keys: ["Delete", "Backspace"] },
  { id: "toggleCompleted", label: "Show or hide completed tasks", keys: ["C"] },
  { id: "undo", label: "Undo the last change (complete, snooze or move)", keys: ["z"] },
  { id: "capture", label: "Add a task", keys: ["c"] },
  { id: "search", label: "Search", keys: ["/"] },
  { id: "contextAll", label: "Show all contexts", keys: ["1"] },
  { id: "contextWork", label: "Show Work", keys: ["2"] },
  { id: "contextPersonal", label: "Show Personal", keys: ["3"] },
  { id: "contextHome", label: "Show Home", keys: ["4"] },
  { id: "nextList", label: "Next list in the sidebar", keys: ["Alt+j"] },
  { id: "previousList", label: "Previous list in the sidebar", keys: ["Alt+k"] },
  { id: "goList", label: "Go to a list", keys: ["g l"] },
  { id: "goTaskList", label: "Go to the task's list", keys: ["G"] },
  { id: "goDashboard", label: "Go to Dashboard", keys: ["g d"] },
  { id: "goInbox", label: "Go to Inbox", keys: ["g i"] },
  { id: "goToday", label: "Go to Today", keys: ["g t"] },
  { id: "goNext", label: "Go to Next", keys: ["g n"] },
  { id: "goWip", label: "Go to WIP", keys: ["g w"] },
  { id: "goWaiting", label: "Go to Waiting", keys: ["g o"] },
  { id: "goSomeday", label: "Go to Someday", keys: ["g s"] },
  { id: "goLabels", label: "Go to Labels", keys: ["g #"] },
  { id: "help", label: "Keyboard shortcuts", keys: ["?"] },
];
