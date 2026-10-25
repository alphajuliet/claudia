// worker/src/mcp/server.ts
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Scope } from "../lib/router";
import { TOOLS, type ApiRequest, type ToolDef } from "./tools";

export type CallApi = (req: ApiRequest) => Promise<{ ok: boolean; status: number; json: any }>;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

/** What Claude sees when the API refuses: the message, plus the first few validation issues. */
function describeError(status: number, json: any): string {
  const err = json?.error;
  if (!err) return `The request failed (${status}).`;
  const issues = Array.isArray(err.issues) && err.issues.length ? ` Details: ${JSON.stringify(err.issues.slice(0, 5))}` : "";
  return `${err.message} (${err.code})${issues}`;
}

export function jsonSchemaOf(tool: ToolDef): Record<string, unknown> {
  const schema = zodToJsonSchema(tool.input, { target: "jsonSchema2019-09", $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** The tools this token may use: read tools always, write tools only with write or admin scope. */
export const toolsFor = (scopes: readonly Scope[]) =>
  TOOLS.filter((t) => t.access === "read" || scopes.includes("write") || scopes.includes("admin"));

export function buildServer(scopes: readonly Scope[], callApi: CallApi) {
  const server = new McpServer({ name: "claudia", version: "0.1.0" });
  for (const tool of toolsFor(scopes)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(jsonSchemaOf(tool)),
        annotations: { readOnlyHint: tool.access === "read", destructiveHint: false, openWorldHint: false },
      },
      async (raw: unknown) => {
        // Our own parse applies defaults and gives the same rules as the API.
        const parsed = tool.input.safeParse(raw);
        if (!parsed.success) return text(`Invalid arguments: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`, true);
        const res = await callApi(tool.request(parsed.data));
        if (!res.ok) return text(describeError(res.status, res.json), true);
        return text(res.json === undefined ? "Done" : JSON.stringify(res.json));
      },
    );
  }
  return server;
}
