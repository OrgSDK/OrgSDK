import { z } from "zod";

export const sessionScopeSchema = z.object({
  workspaceId: z.string().min(1).max(256),
  projectId: z.uuid(),
  ownerId: z.string().min(1).max(256),
});

export const sessionCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("open") }),
  z.strictObject({
    operation: z.literal("execute"),
    id: z.uuid(),
    cellId: z.uuid(),
    generation: z.number().int().positive(),
    expectedSequence: z.number().int().nonnegative(),
    after: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ operation: z.literal("close"), id: z.uuid() }),
  z.strictObject({
    operation: z.literal("read"),
    id: z.uuid(),
    after: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(10).optional(),
  }),
]);
