import { createRoute } from "@hono/zod-openapi";
import { BackupResultSchema } from "@claudia/shared";
import { backUp } from "../backup";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

export const backupRoutes = newRouter().openapi(
  createRoute({
    method: "post",
    path: "/api/backup",
    tags: ["System"],
    summary: "Back up the database now (admin)",
    description:
      "Writes the whole database as SQL to the backups bucket, as the nightly backup does, replacing today's. Restore with `wrangler d1 execute <name> --remote --file <dump>.sql` into an empty database.",
    responses: { 200: jsonResponse(BackupResultSchema, "Backed up"), ...commonErrors },
  }),
  async (c) => c.json(await backUp(c.env), 200),
);
