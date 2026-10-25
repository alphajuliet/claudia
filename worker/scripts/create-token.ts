// Create an API token directly in D1. Use it to mint the first admin token;
// after that, tokens come from POST /api/tokens.
//
//   npm run token:create -w @claudia/worker -- --remote --name laptop --scopes admin
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { generateToken, hashToken } from "../src/lib/auth";
import { newId, now } from "../src/lib/ids";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "bootstrap" },
    scopes: { type: "string", default: "admin" },
    local: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});
if (values.local === values.remote) {
  console.error("Pass exactly one of --local or --remote");
  process.exit(1);
}
const scopes = values.scopes!.split(",");
if (!scopes.every((s) => ["read", "write", "admin"].includes(s))) {
  console.error("Scopes must be from: read, write, admin");
  process.exit(1);
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const secret = generateToken();
const id = newId();
const at = now();
const sql = [
  `INSERT INTO tokens (id, name, hash, scopes, created_at) VALUES (${quote(id)}, ${quote(values.name!)}, ${quote(await hashToken(secret))}, ${quote(JSON.stringify(scopes))}, ${quote(at)});`,
  `INSERT INTO events (id, entity_type, entity_id, type, after, at, actor) VALUES (${quote(newId())}, 'token', ${quote(id)}, 'created', ${quote(JSON.stringify({ name: values.name, scopes }))}, ${quote(at)}, 'cli');`,
].join(" ");

execFileSync("npx", ["wrangler", "d1", "execute", "claudia", values.local ? "--local" : "--remote", "--command", sql], {
  stdio: ["ignore", "ignore", "inherit"],
});
console.log(`Created token '${values.name}' (${scopes.join(", ")}). It is shown once:\n\n${secret}\n`);
