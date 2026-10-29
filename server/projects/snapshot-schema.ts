import { z } from "zod";
import type { JsonObject } from "../db/types";

const resourceGrant = z.object({
  read: z.array(z.string()).default([]),
  write: z.array(z.string()).default([]),
});
const agentsSchema = z.array(
  z.object({
    id: z.string(),
    resources: z
      .object({ tables: resourceGrant, documents: resourceGrant })
      .optional(),
    plugins: z
      .array(z.object({ credential_id: z.string().nullable().optional() }))
      .default([]),
  }),
);

export function snapshotAgents(snapshot: JsonObject) {
  return agentsSchema.parse(snapshot.agents ?? []);
}
