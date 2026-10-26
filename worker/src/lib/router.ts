import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { ACTORS } from "../db/schema";
import type { Db } from "./db";
import { ErrorSchema, type SCOPES } from "@claudia/shared";

export type Actor = (typeof ACTORS)[number];
export type Scope = (typeof SCOPES)[number];

export interface AppEnv {
  Bindings: Cloudflare.Env;
  Variables: { db: Db; actor: Actor; scopes: Scope[]; identity: { name: string; expiresAt: string | null } };
}

/** A router whose request-validation failures use the API's error shape. */
export const newRouter = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "validation_error",
              message: "Request validation failed",
              issues: result.error.issues,
            },
          },
          400,
        );
      }
    },
  });

export const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true as const,
});

export const jsonResponse = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const errorResponse = (description: string) => jsonResponse(ErrorSchema, description);

/** Error responses every authenticated route can return. */
export const commonErrors = {
  400: errorResponse("Validation error"),
  401: errorResponse("Missing or invalid token"),
  403: errorResponse("Token lacks the required scope"),
};
export const notFoundError = { 404: errorResponse("Not found") };
export const conflictError = { 409: errorResponse("Conflict") };
