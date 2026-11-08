import { z } from "zod";
import { connectionSchema } from "./mcp/contract";

export const pluginSchema = z.object({
  distribution: z.enum(["inline", "external", "mcp"]).optional(),
  mcp: connectionSchema.optional(),
  package_url: z.string().optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  credential_provider: z.string().nullable().optional(),
  contract_version: z.literal(1).optional(),
  slug: z.string(),
  version: z.string(),
  source: z.string(),
  digest: z.string(),
  credential_id: z.string().nullable(),
});
export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  plugins: z.array(pluginSchema),
  resources: z
    .object({
      tables: z.object({
        read: z.array(z.string().uuid()),
        write: z.array(z.string().uuid()),
      }),
      documents: z.object({
        read: z.array(z.string().uuid()),
        write: z.array(z.string().uuid()),
      }),
    })
    .optional(),
});
export const jobSchema = z
  .object({
    protocol_version: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    run_id: z.string().uuid(),
    workspace_id: z.number(),
    actor_id: z.number(),
    operation: z.enum([
      "action",
      "chat",
      "code",
      "validate",
      "test",
      "mcp_discover",
    ]),
    capability: z.string(),
    inputs: z.record(z.string(), z.unknown()),
    deadline: z.string(),
    lease_seconds: z.number(),
    snapshot: z.object({
      mcp_discovery: connectionSchema.optional(),
      agents: z.array(agentSchema),
      root_agent_id: z.string(),
      validation_mode: z.enum(["legacy", "semantic"]).optional(),
      sdk: z.unknown().optional(),
      input_schema: z.record(z.string(), z.json()).nullable().optional(),
      output_schema: z.record(z.string(), z.json()).nullable().optional(),
      test_suite: z
        .object({
          id: z.string().optional(),
          revision: z.number().optional(),
          digest: z.string().optional(),
          cases: z.array(z.unknown()),
        })
        .optional(),
      source: z.string().optional(),
      source_digest: z.string().optional(),
      version: z.number().optional(),
      sdk_revision: z.number().int().optional(),
      configuration_revision: z.string().optional(),
    }),
  })
  .refine(
    (job) =>
      job.protocol_version === 4 ||
      (job.operation !== "mcp_discover" &&
        !job.snapshot.mcp_discovery &&
        !job.snapshot.agents.some((agent) =>
          agent.plugins.some((plugin) => plugin.distribution === "mcp"),
        )),
    { message: "MCP connections require protocol version 4" },
  )
  .refine(
    (job) => job.operation !== "code" || [2, 4].includes(job.protocol_version),
    {
      message: "Code execution requires protocol version 2",
    },
  )
  .refine(
    (job) =>
      (!["validate", "test"].includes(job.operation) &&
        job.snapshot.validation_mode !== "semantic") ||
      [3, 4].includes(job.protocol_version),
    { message: "Semantic validation and tests require protocol version 3" },
  );
export type Job = z.infer<typeof jobSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Plugin = z.infer<typeof pluginSchema>;
