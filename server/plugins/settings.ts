import { z } from "zod";
import type { ServiceContext } from "../application";
import { credentialCreateSchema } from "../credentials/schemas";
import type { plugins } from "../db/schema";
import { projectGrant } from "../domain/permissions";
import { pluginsRepository } from "../repositories/plugins";
import { ServiceError } from "../shared/errors";
import { digest } from "../shared/security";
import { supportsShellPolicy } from "./shell-policy";

export const configurePluginSchema = z
  .strictObject({
    id: z.uuid(),
    revision: z.string().regex(/^[a-f\d]{64}$/),
    configuration: z.record(z.string(), z.json()).optional(),
    credential: credentialCreateSchema
      .omit({ provider: true })
      .nullable()
      .optional(),
  })
  .refine(
    (input) =>
      input.configuration !== undefined || input.credential !== undefined,
    "Supply configuration or a credential change.",
  );

export function canConfigurePlugin(plugin: typeof plugins.$inferSelect) {
  return plugin.distribution === "external" && !supportsShellPolicy(plugin);
}

export function findConfigurablePlugin(context: ServiceContext, id: string) {
  const plugin = pluginsRepository(context).find(id);
  projectGrant(context, plugin.projectId);
  if (!canConfigurePlugin(plugin)) {
    throw new ServiceError("BAD_REQUEST", "Configure this plugin in Studio.");
  }
  return plugin;
}

export function pluginSettings(plugin: typeof plugins.$inferSelect) {
  return {
    id: plugin.id,
    project: plugin.projectId,
    slug: plugin.slug,
    version: plugin.version,
    enabled: plugin.enabled,
    configuration: plugin.configuration,
    configuration_schema: plugin.releaseMetadata.configuration_schema ?? {},
    credential_connected: plugin.credentialId !== null,
    credential_provider: plugin.releaseMetadata.auth?.provider ?? null,
    credential_auth_type: plugin.releaseMetadata.auth?.type ?? null,
    revision: digest(
      JSON.stringify([
        plugin.digest,
        plugin.version,
        plugin.configuration,
        plugin.credentialId,
        plugin.releaseMetadata.configuration_schema,
        plugin.releaseMetadata.auth,
      ]),
    ),
  };
}
