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
      .array(
        z.object({
          credential_id: z.string().nullable().optional(),
          distribution: z.string().optional(),
          mcp: z.object({ id: z.uuid() }).optional(),
        }),
      )
      .default([]),
  }),
);

export function snapshotAgents(snapshot: JsonObject) {
  return agentsSchema.parse(snapshot.agents ?? []);
}

export function snapshotUsesMcp(snapshot: JsonObject) {
  const sdk = z
    .object({
      plugins: z.array(z.object({ kind: z.string().optional() })).optional(),
    })
    .safeParse(snapshot.sdk);
  return (
    snapshotAgents(snapshot).some((agent) =>
      agent.plugins.some((plugin) => plugin.distribution === "mcp"),
    ) ||
    (sdk.success &&
      sdk.data.plugins?.some((plugin) => plugin.kind === "mcp")) === true
  );
}
