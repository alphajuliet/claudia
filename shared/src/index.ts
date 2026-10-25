import { z } from "zod";

export const HealthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("claudia"),
});

export type Health = z.infer<typeof HealthSchema>;
