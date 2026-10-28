import { z } from "zod";

const jsonObject = z.record(z.string(), z.json());
const slug = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/);
export const releaseSchema = z
  .object({
    slug,
    version: z.string().min(1).max(100),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    package_url: z.string(),
    display_name: z.string(),
    description: z.string(),
    category: z.string(),
    documentation: z.string(),
    distribution: z.literal("external"),
    contract_version: z.literal(1),
    auth: z
      .object({
        type: z.string().optional(),
        provider: z.string().optional(),
        label: z.string().optional(),
        hint: z.string().optional(),
        scopes: z.array(z.string()).optional(),
      })
      .catchall(z.json()),
    marketplace: jsonObject,
    configuration_schema: jsonObject,
    tools: z.array(jsonObject),
  })
  .catchall(z.json());

export const marketplaceSchema = z.object({
  schema_version: z.literal(1),
  plugins: z.array(
    z
      .object({
        slug,
        display_name: z.string(),
        description: z.string(),
        category: z.string(),
        permissions: z.string(),
        source_version: z.string(),
        source_url: z.string(),
        url: z.string(),
        release_status: z.enum(["unreleased", "available"]),
        auth_type: z.enum(["none", "token", "oauth2"]),
        tags: z.array(z.string()),
        use_cases: z.array(z.string()),
      })
      .catchall(z.json()),
  ),
});
