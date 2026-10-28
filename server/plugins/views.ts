import type * as schema from "../db/schema";
export const pluginView = (plugin: typeof schema.plugins.$inferSelect) => {
  return {
    id: plugin.id,
    project: plugin.projectId,
    slug: plugin.slug,
    version: plugin.version,
    description: plugin.description,
    source: plugin.source,
    digest: plugin.digest,
    enabled: plugin.enabled,
    credential: plugin.credentialId,
    distribution: plugin.distribution,
    configuration: plugin.configuration,
    package_url: plugin.packageUrl,
    tools: plugin.releaseMetadata?.tools ?? null,
    auth: plugin.releaseMetadata?.auth ?? {},
    display_name: plugin.releaseMetadata?.display_name ?? plugin.slug,
    icon_url: plugin.releaseMetadata?.marketplace?.icon_url ?? "",
  };
};
