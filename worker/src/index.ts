import { HealthSchema } from "@claudia/shared";
import { createRoute } from "@hono/zod-openapi";
import { authenticate } from "./lib/auth";
import { createDb } from "./lib/db";
import { ApiError } from "./lib/errors";
import { jsonResponse, newRouter } from "./lib/router";
import { folderRoutes } from "./routes/folders";
import { filterRoutes } from "./routes/filters";
import { labelRoutes } from "./routes/labels";
import { listRoutes } from "./routes/lists";
import { settingRoutes } from "./routes/settings";
import { taskRoutes } from "./routes/tasks";
import { tokenRoutes } from "./routes/tokens";

export const app = newRouter();

app.use("/api/*", async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

// Public: liveness and the spec. Everything else under /api needs a token.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/openapi.json") return next();
  return authenticate(c, next);
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, issues: err.issues } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    tags: ["System"],
    responses: { 200: jsonResponse(HealthSchema, "Service is up") },
  }),
  (c) => c.json({ ok: true as const, service: "claudia" as const }, 200),
);

app.route("/", tokenRoutes);
app.route("/", folderRoutes);
app.route("/", listRoutes);
app.route("/", taskRoutes);
app.route("/", labelRoutes);
app.route("/", filterRoutes);
app.route("/", settingRoutes);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "API token created with POST /api/tokens (prefix cl_)",
});

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { title: "Claudia API", version: "0.1.0" },
  security: [{ bearerAuth: [] }],
});

export default app;
