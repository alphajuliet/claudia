// Import a Godspeed export (see fetch.ts) into Claudia through POST /api/import.
// Safe to repeat: IDs are derived from Godspeed's, and existing ones are skipped.
//
//   CLAUDIA_TOKEN=cl_... npm run godspeed:import -w @claudia/worker -- --url https://claudia.alphajuliet.com
//   npm run godspeed:import -w @claudia/worker -- --dry-run     (no network; prints the report)
//
// Open tasks only, unless you pass --include-completed (the export must include them too).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { IMPORT_MAX_ITEMS, type ImportBatch } from "@claudia/shared";
import { transform, type GsExport } from "./transform";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:8787" },
    dir: { type: "string", default: "godspeed-export" },
    "dry-run": { type: "boolean", default: false },
    "include-completed": { type: "boolean", default: false },
  },
});

const read = async (name: string) => JSON.parse(await readFile(join(values.dir!, name), "utf8"));
const gs: GsExport = {
  lists: await read("lists.json"),
  labels: await read("labels.json"),
  open: await read("tasks-incomplete.json"),
  // Completed tasks are history; leave them behind unless asked.
  completed: values["include-completed"] ? await read("tasks-complete.json") : [],
};

const result = await transform(gs);
const { report } = result;
await writeFile(join(values.dir!, "import-report.json"), JSON.stringify(report, null, 1));

const open = result.tasks.filter((t) => !t.completedAt).length;
console.log(
  `Prepared ${result.folders.length} folders, ${result.lists.length} lists, ${result.labels.length} labels, ` +
    `${result.tasks.length} tasks (${open} open${result.tasks.length > open ? `, ${result.tasks.length - open} completed` : ""})`,
);
console.log(
  `Not imported: ${report.skippedSmartLists.length} smart lists, ${report.skippedFolders.length} folders of smart lists only, ` +
    `${report.skippedTasks.length} tasks. Dropped recurrence on ${report.droppedRecurrence.length}. ` +
    `Merged ${report.mergedLabels.length} labels. Details: ${join(values.dir!, "import-report.json")}`,
);
for (const w of report.warnings) console.log(`Warning: ${w}`);
if (values["dry-run"]) process.exit(0);

const token = process.env.CLAUDIA_TOKEN;
if (!token) throw new Error("Set CLAUDIA_TOKEN to an admin token");

async function send(batch: Partial<ImportBatch>) {
  const res = await fetch(new URL("/api/import", values.url), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Claudia-Client": "import" },
    body: JSON.stringify(batch),
  });
  if (!res.ok) throw new Error(`Import failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { inserted: Record<string, number>; skipped: Record<string, number> };
}

const total = { inserted: { folders: 0, lists: 0, labels: 0, tasks: 0 }, skipped: { folders: 0, lists: 0, labels: 0, tasks: 0 } } as Record<"inserted" | "skipped", Record<string, number>>;
const add = (r: Awaited<ReturnType<typeof send>>) => {
  for (const k of ["inserted", "skipped"] as const) for (const [name, n] of Object.entries(r[k])) total[k][name] = (total[k][name] ?? 0) + n;
};

// Structure first (folders and lists are few), then tasks in chunks. Each chunk
// carries the labels its tasks use, so the server can match them by name.
add(await send({ folders: result.folders, lists: result.lists }));
const labelsById = new Map(result.labels.map((l) => [l.id, l]));
const CHUNK = IMPORT_MAX_ITEMS - result.labels.length;
for (let i = 0; i < result.tasks.length; i += CHUNK) {
  const tasks = result.tasks.slice(i, i + CHUNK);
  const used = new Set(tasks.flatMap((t) => t.labelIds));
  add(await send({ labels: [...used].map((id) => labelsById.get(id)!), tasks }));
  console.log(`  ${Math.min(i + CHUNK, result.tasks.length)} / ${result.tasks.length} tasks`);
}
// Labels are re-sent with every chunk, so their "skipped" count is noise.
delete total.skipped.labels;
console.log("Inserted:", total.inserted, "Skipped (already present):", total.skipped);
