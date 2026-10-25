import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HealthSchema } from "@claudia/shared";

const app = new OpenAPIHono();

app.openapi(
  createRoute({
    method: "get",
    path: "/api/health",
    responses: {
      200: {
        content: { "application/json": { schema: HealthSchema } },
        description: "Service is up",
      },
    },
  }),
  (c) => c.json({ ok: true as const, service: "claudia" as const }, 200),
);

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { title: "Claudia API", version: "0.1.0" },
});

export default app;
