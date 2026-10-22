import { z } from "zod";

export const pluginSchema = z.object({
  distribution: z.enum(["inline", "external"]).optional(),
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
    protocol_version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    run_id: z.string().uuid(),
    workspace_id: z.number(),
    actor_id: z.number(),
    operation: z.enum(["action", "chat", "code", "validate", "test"]),
    capability: z.string(),
    inputs: z.record(z.string(), z.unknown()),
    deadline: z.string(),
    lease_seconds: z.number(),
    snapshot: z.object({
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
  .refine((job) => job.operation !== "code" || job.protocol_version === 2, {
    message: "Code execution requires protocol version 2",
  })
  .refine(
    (job) =>
      (!["validate", "test"].includes(job.operation) &&
        job.snapshot.validation_mode !== "semantic") ||
      job.protocol_version === 3,
    { message: "Semantic validation and tests require protocol version 3" },
  );
export type Job = z.infer<typeof jobSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Plugin = z.infer<typeof pluginSchema>;
