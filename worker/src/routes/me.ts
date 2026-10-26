import { createRoute } from "@hono/zod-openapi";
import { MeSchema } from "@claudia/shared";
import { commonErrors, jsonResponse, newRouter } from "../lib/router";

export const meRoutes = newRouter().openapi(
  createRoute({
    method: "get",
    path: "/api/me",
    tags: ["System"],
    summary: "Who the calling token is",
    description: "The token's name, scopes and expiry. Never the secret. Any valid token can call it.",
    responses: { 200: jsonResponse(MeSchema, "The calling token"), ...commonErrors },
  }),
  (c) => c.json({ ...c.var.identity, scopes: c.var.scopes }, 200),
);
