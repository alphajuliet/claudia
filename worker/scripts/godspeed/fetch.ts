// Download everything from Godspeed into a local folder (git-ignored), so the
// import can be re-run without hitting Godspeed's rate limits.
//
//   GODSPEED_API_KEY=... npm run godspeed:fetch -w @claudia/worker [-- --out godspeed-export] [--include-completed]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const BASE = "https://api.godspeedapp.com";
const GAP_MS = 7000; // listing is limited to 10 requests a minute

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "godspeed-export" },
    "include-completed": { type: "boolean", default: false }, // adds minutes: there are thousands
  },
});
const key = process.env.GODSPEED_API_KEY;
if (!key) throw new Error("Set GODSPEED_API_KEY");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string): Promise<any> {
  for (;;) {
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 429) {
      console.error("Rate limited; waiting 60s");
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

// Pages come newest-updated first, 250 at a time. The cursor overlaps by 1ms so
// tasks sharing a timestamp aren't skipped; duplicates are dropped by id.
async function allTasks(status: "incomplete" | "complete") {
  const tasks = new Map<string, any>();
  const labels = new Map<string, any>();
  let before: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ status });
    if (before) q.set("updated_before", before);
    const page = await get(`/tasks?${q}`);
    await sleep(GAP_MS);
    const fresh = (page.tasks as any[]).filter((t) => !tasks.has(t.id));
    for (const t of fresh) tasks.set(t.id, t);
    for (const l of page.labels ?? []) labels.set(l.id, l);
    console.error(`${status}: ${tasks.size} tasks`);
    if (fresh.length === 0 || page.tasks.length < 250) break;
    before = new Date(Date.parse(page.tasks.at(-1).updated_at) + 1).toISOString();
  }
  return { tasks: [...tasks.values()], labels: [...labels.values()] };
}

await mkdir(values.out!, { recursive: true });
const save = (name: string, data: unknown) => writeFile(join(values.out!, name), JSON.stringify(data, null, 1));

const lists = await get("/lists");
await save("lists.json", lists.lists);
await sleep(GAP_MS);

const incomplete = await allTasks("incomplete");
await save("tasks-incomplete.json", incomplete.tasks);
const complete = values["include-completed"] ? await allTasks("complete") : { tasks: [], labels: [] };
if (values["include-completed"]) await save("tasks-complete.json", complete.tasks);

const labels = new Map([...incomplete.labels, ...complete.labels].map((l) => [l.id, l]));
await save("labels.json", [...labels.values()]);
console.error(`Done: ${lists.lists.length} lists, ${incomplete.tasks.length} open, ${complete.tasks.length} completed (skipped unless --include-completed), ${labels.size} labels`);
