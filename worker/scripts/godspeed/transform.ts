// Turn a Godspeed export into Claudia import batches. Pure functions: no I/O.
import { generateNKeysBetween } from "fractional-indexing";
import type { ImportBatch } from "@claudia/shared";

export const TIME_ZONE = "Australia/Sydney";

// Godspeed shapes (only the fields used here).
export interface GsList {
  id: string; name: string; order_index: number; created_at: string; updated_at: string;
  archived_at: string | null; list_type: "inbox" | "folder" | "list" | "smart"; indent_level: number;
  smart_list_query: string | null;
}
export interface GsLabel { id: string; name: string; created_at: string; deleted_at: string | null }
export interface GsTask {
  id: string; list_id: string; title: string; notes: string | null; order_index: number; indent_level: number;
  created_at: string; updated_at: string; completed_at: string | null; cleared_at: string | null;
  completed_parent_todo_item_id: string | null;
  due_at: string | null; timeless_due_at: string | null; starts_at: string | null; timeless_starts_at: string | null;
  snoozed_until: string | null; timeless_snoozed_until: string | null;
  duration_minutes: number | null; label_ids: string[]; metadata: Record<string, unknown> | null;
  repeat_from: string | null; repeat_unit: string | null; repeat_value: number | null;
  repeat_unit_metadata: { weekdays?: string[]; monthDays?: number[] } | null;
  snooze_count?: number; bookmarked_at?: string | null;
  todo_item_emails?: unknown[]; todo_item_attachments?: unknown[];
}
export interface GsExport { lists: GsList[]; labels: GsLabel[]; open: GsTask[]; completed: GsTask[] }

export interface Report {
  skippedSmartLists: { name: string; query: string | null }[];
  skippedFolders: string[];
  skippedTasks: { id: string; reason: string }[];
  droppedRecurrence: { id: string; reason: string }[];
  mergedLabels: { from: string; into: string }[];
  warnings: string[];
}

// ---- IDs ---------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID derived from the Godspeed ID: the time part comes from `createdAt`,
 * the rest from a hash. The same input always gives the same ID, so the
 * import can be repeated without a mapping table.
 */
export async function importId(kind: string, godspeedId: string, createdAt: string): Promise<string> {
  let ms = Date.parse(createdAt);
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[ms % 32]! + time;
    ms = Math.floor(ms / 32);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`claudia-import:${kind}:${godspeedId}`)));
  let bits = 0n;
  for (const byte of digest.slice(0, 10)) bits = (bits << 8n) | BigInt(byte);
  let random = "";
  for (let i = 0; i < 16; i++) {
    random = CROCKFORD[Number(bits & 31n)]! + random;
    bits >>= 5n;
  }
  return time + random;
}

// ---- Dates -------------------------------------------------------------

const iso = (s: string) => new Date(s).toISOString();

const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** The calendar date in Sydney at an instant. */
export const sydneyDate = (instant: string) => dateParts.format(new Date(instant));

const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" });
function offsetMinutes(at: Date): number {
  const name = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")!.value; // GMT+11 or GMT+10:30
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
/** The UTC instant of 00:00 on a Sydney calendar date. */
export function sydneyMidnight(date: string): string {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let guess = utcMidnight - offsetMinutes(new Date(utcMidnight)) * 60_000;
  guess = utcMidnight - offsetMinutes(new Date(guess)) * 60_000; // settle across a DST change
  return new Date(guess).toISOString();
}

// ---- Recurrence --------------------------------------------------------

const BYDAY: Record<string, string> = { Sun: "SU", Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR", Sat: "SA" };

export function recurrence(t: GsTask): { recurRule: string; recurFrom: "due" | "completion" } | { error: string } | null {
  if (!t.repeat_unit) return null;
  const n = t.repeat_value ?? 1;
  const freq = { days: "DAILY", weeks: "WEEKLY", months: "MONTHLY", years: "YEARLY" }[t.repeat_unit];
  const from = t.repeat_from === "completion" ? "completion" : t.repeat_from === "due date" ? "due" : null;
  if (!freq) return { error: `unknown repeat unit '${t.repeat_unit}'` };
  if (!from) return { error: `unknown repeat_from '${t.repeat_from}'` };

  const parts = [`FREQ=${freq}`];
  if (n !== 1) parts.push(`INTERVAL=${n}`);
  const weekdays = t.repeat_unit_metadata?.weekdays ?? [];
  if (t.repeat_unit === "weeks" && weekdays.length) {
    const days = weekdays.map((d) => BYDAY[d]);
    if (days.some((d) => !d)) return { error: `unknown weekday in ${JSON.stringify(weekdays)}` };
    parts.push(`BYDAY=${days.join(",")}`);
  }
  const monthDays = t.repeat_unit_metadata?.monthDays ?? [];
  if (t.repeat_unit === "months" && monthDays.length) parts.push(`BYMONTHDAY=${monthDays.join(",")}`);
  return { recurRule: parts.join(";"), recurFrom: from };
}

// ---- Folders and lists -------------------------------------------------

const stripEmoji = (s: string) => s.replace(/[^\p{L}\p{N}\s&+|/-]/gu, "").trim();

/** Work, Personal and Home are the top-level folders that carry a context. */
export function contextFor(topLevelName: string): "work" | "personal" | "home" | null {
  const n = stripEmoji(topLevelName).toLowerCase();
  return n === "work" ? "work" : n === "personal" ? "personal" : n === "home" ? "home" : null;
}

export async function transformStructure(gs: GsList[], report: Report) {
  const sorted = [...gs].sort((a, b) => a.order_index - b.order_index);

  // Which folders hold only smart lists (Godspeed's "Filters")? They aren't imported.
  const hasRealChild = new Set<string>();
  const stack: GsList[] = [];
  const parentOf = new Map<string, GsList | null>();
  for (const l of sorted) {
    while (stack.length && stack.at(-1)!.indent_level >= l.indent_level) stack.pop();
    const parent = stack.at(-1) ?? null;
    parentOf.set(l.id, parent);
    if (l.list_type === "folder") stack.push(l);
    if (parent && l.list_type !== "smart") {
      for (let p: GsList | null | undefined = parent; p; p = parentOf.get(p.id)) hasRealChild.add(p.id);
    }
  }

  const folders = new Map<string, ImportBatch["folders"][number]>();
  const lists: ImportBatch["lists"] = [];
  const listIds = new Map<string, string>();
  const contextOfFolder = new Map<string, "work" | "personal" | "home">();
  const folderIds = new Map<string, string>();

  for (const l of sorted) {
    if (l.list_type === "smart") {
      report.skippedSmartLists.push({ name: l.name, query: l.smart_list_query });
      continue;
    }
    const parent = parentOf.get(l.id) ?? null;
    if (l.list_type === "folder") {
      if (!hasRealChild.has(l.id)) {
        report.skippedFolders.push(l.name);
        continue;
      }
      const context = parent ? contextOfFolder.get(parent.id) : contextFor(l.name);
      if (!context) report.warnings.push(`Folder '${l.name}' isn't Work, Personal or Home; imported as personal`);
      contextOfFolder.set(l.id, context ?? "personal");
      const id = await importId("folder", l.id, l.created_at);
      folderIds.set(l.id, id);
      folders.set(l.id, {
        id, name: l.name, parentId: parent ? folderIds.get(parent.id) ?? null : null, context: context ?? "personal",
        position: "", createdAt: iso(l.created_at), updatedAt: iso(l.updated_at),
      });
    } else {
      const id = await importId("list", l.id, l.created_at);
      listIds.set(l.id, id);
      lists.push({
        id, name: l.name, folderId: parent ? folderIds.get(parent.id) ?? null : null, position: "",
        archivedAt: l.archived_at ? iso(l.archived_at) : null, createdAt: iso(l.created_at), updatedAt: iso(l.updated_at),
      });
    }
  }

  // Positions: keep Godspeed's order among siblings.
  assignPositions([...folders.values()], (f) => f.parentId ?? "");
  assignPositions(lists, (l) => l.folderId ?? "");
  return { folders: [...folders.values()], lists, listIds };
}

/** Give each item a fractional index, in array order within its sibling group. */
function assignPositions<T extends { position: string }>(items: T[], group: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(group(item), [...(groups.get(group(item)) ?? []), item]);
  for (const members of groups.values()) {
    generateNKeysBetween(null, null, members.length).forEach((key, i) => (members[i]!.position = key));
  }
}

// ---- Labels ------------------------------------------------------------

export async function transformLabels(gs: GsLabel[], report: Report) {
  const byName = new Map<string, ImportBatch["labels"][number]>();
  const remap = new Map<string, string>(); // Godspeed label id -> Claudia id
  for (const l of [...gs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (l.deleted_at) continue;
    const key = l.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      report.mergedLabels.push({ from: l.name, into: existing.name });
      remap.set(l.id, existing.id);
      continue;
    }
    const label = { id: await importId("label", l.id, l.created_at), name: l.name.trim(), createdAt: iso(l.created_at) };
    byName.set(key, label);
    remap.set(l.id, label.id);
  }
  return { labels: [...byName.values()], remap };
}

// ---- Tasks -------------------------------------------------------------

const HEADING = /^::\s*/;

export async function transformTasks(
  gs: { open: GsTask[]; completed: GsTask[] },
  listIds: Map<string, string>,
  labelRemap: Map<string, string>,
  report: Report,
): Promise<ImportBatch["tasks"]> {
  const out: ImportBatch["tasks"] = [];
  const claudiaId = new Map<string, string>();
  const everyTask = [...gs.open, ...gs.completed];
  const completedIds = new Set(gs.completed.map((t) => t.id));
  for (const t of everyTask) claudiaId.set(t.id, await importId("task", t.id, t.created_at));

  const build = (t: GsTask, parentGsId: string | null): ImportBatch["tasks"][number] => {
    const heading = HEADING.test(t.title);
    const done = !!(t.completed_at || t.cleared_at) || completedIds.has(t.id);
    const rec = done ? null : recurrence(t);
    if (rec && "error" in rec) report.droppedRecurrence.push({ id: t.id, reason: rec.error });

    const dueDate = t.timeless_due_at ?? null;
    const dueAt = !dueDate && t.due_at ? iso(t.due_at) : null;
    const startDate = t.timeless_starts_at ?? (t.starts_at ? sydneyDate(t.starts_at) : null);
    const snoozedUntil = t.snoozed_until ? iso(t.snoozed_until) : t.timeless_snoozed_until ? sydneyMidnight(t.timeless_snoozed_until) : null;

    const godspeed: Record<string, unknown> = { id: t.id };
    if (t.duration_minutes) godspeed.durationMinutes = t.duration_minutes;
    if (t.starts_at && !t.timeless_starts_at) godspeed.startsAt = iso(t.starts_at);
    if (t.snooze_count) godspeed.snoozeCount = t.snooze_count;
    if (t.bookmarked_at) godspeed.bookmarkedAt = iso(t.bookmarked_at);
    if (t.metadata && Object.keys(t.metadata).length) godspeed.metadata = t.metadata;
    if (t.todo_item_emails?.length) godspeed.emails = t.todo_item_emails;
    if (t.todo_item_attachments?.length) godspeed.attachments = t.todo_item_attachments;
    if (t.repeat_unit && (done || (rec && "error" in rec))) {
      godspeed.repeat = { from: t.repeat_from, unit: t.repeat_unit, value: t.repeat_value, ...t.repeat_unit_metadata };
    }

    return {
      id: claudiaId.get(t.id)!,
      listId: listIds.get(t.list_id)!,
      parentId: parentGsId ? claudiaId.get(parentGsId) ?? null : null,
      kind: heading ? "heading" : "task",
      position: "",
      title: (heading ? t.title.replace(HEADING, "") : t.title).trim() || "(untitled)",
      notes: t.notes?.trim() ? t.notes : null,
      dueDate, dueAt, startDate, snoozedUntil,
      recurRule: rec && !("error" in rec) ? rec.recurRule : null,
      recurFrom: rec && !("error" in rec) ? rec.recurFrom : null,
      completedAt: done ? iso(t.completed_at ?? t.cleared_at ?? t.updated_at) : null,
      metadata: { godspeed },
      labelIds: [...new Set(t.label_ids.map((id) => labelRemap.get(id)).filter((id): id is string => !!id))],
      createdAt: iso(t.created_at),
      updatedAt: iso(t.updated_at),
    };
  };

  // Open tasks: nesting comes from indent levels, read in list order.
  const openByList = new Map<string, GsTask[]>();
  for (const t of gs.open) {
    if (!listIds.has(t.list_id)) {
      report.skippedTasks.push({ id: t.id, reason: "its list was not imported" });
      continue;
    }
    openByList.set(t.list_id, [...(openByList.get(t.list_id) ?? []), t]);
  }
  for (const tasks of openByList.values()) {
    tasks.sort((a, b) => a.order_index - b.order_index);
    let stack: GsTask[] = []; // open ancestors since the last heading
    for (const t of tasks) {
      if (HEADING.test(t.title)) {
        stack = [];
        out.push(build(t, null));
        continue;
      }
      while (stack.length && stack.at(-1)!.indent_level >= t.indent_level) stack.pop();
      out.push(build(t, stack.at(-1)?.id ?? null));
      stack.push(t);
    }
  }

  // Completed tasks: re-attach to their former parent when it was imported in the same list.
  const imported = new Map(everyTask.map((t) => [t.id, t]));
  for (const t of [...gs.completed].sort((a, b) => a.order_index - b.order_index)) {
    if (!listIds.has(t.list_id)) {
      report.skippedTasks.push({ id: t.id, reason: "its list was not imported" });
      continue;
    }
    const wanted = t.completed_parent_todo_item_id;
    const parent = wanted ? imported.get(wanted) : undefined;
    const ok = parent && parent.list_id === t.list_id && !HEADING.test(parent.title) && !HEADING.test(t.title);
    out.push(build(t, ok ? wanted : null));
  }

  // Parents before children, then positions within each sibling group.
  const ordered = parentsFirst(out);
  assignPositions(ordered, (t) => `${t.listId}/${t.parentId ?? ""}`);
  return ordered;
}

function parentsFirst<T extends { id: string; parentId: string | null }>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: T[] = [];
  const visit = (i: T, trail = new Set<string>()) => {
    if (seen.has(i.id)) return;
    if (trail.has(i.id)) throw new Error(`Cycle at task ${i.id}`);
    trail.add(i.id);
    const parent = i.parentId ? byId.get(i.parentId) : undefined;
    if (parent) visit(parent, trail);
    seen.add(i.id);
    out.push(i);
  };
  for (const i of items) visit(i);
  return out;
}

// ---- Everything --------------------------------------------------------

export async function transform(gs: GsExport) {
  const report: Report = { skippedSmartLists: [], skippedFolders: [], skippedTasks: [], droppedRecurrence: [], mergedLabels: [], warnings: [] };
  const structure = await transformStructure(gs.lists, report);
  const { labels, remap } = await transformLabels(gs.labels, report);
  const tasks = await transformTasks(gs, structure.listIds, remap, report);
  return { folders: structure.folders, lists: structure.lists, labels, tasks, report };
}
