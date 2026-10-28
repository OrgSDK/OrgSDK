import type * as t from "../db/schema";
import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { credentialsRepository } from "../repositories/credentials";
import { pluginsRepository } from "../repositories/plugins";
import { projectsRepository } from "../repositories/projects";
import { jsonValue, sourceText, validateContract } from "../shared/contracts";
import { digest } from "../shared/security";
import { booleanValue, optionalDescription, text } from "../shared/validation";
import { catalogEntries, catalogRelease, marketplaceEntries } from "./catalog";
export async function handlePlugins(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "plugins") return null;
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  browser(ctx, method !== "GET");

  const view = (r: typeof t.plugins.$inferSelect) => {
    return {
      id: r.id,
      agent: r.projectId,
      slug: r.slug,
      version: r.version,
      description: r.description,
      source: r.source,
      digest: r.digest,
      enabled: r.enabled,
      credential: r.credentialId,
      distribution: r.distribution,
      configuration: r.configuration,
      package_url: r.packageUrl,
      tools: r.releaseMetadata?.tools ?? null,
      display_name: r.releaseMetadata?.display_name ?? r.slug,
      icon_url: r.releaseMetadata?.marketplace?.icon_url ?? "",
    };
  };
  if (resource === "plugins" && id === "catalog" && method === "GET")
    return json(await catalogEntries());
  if (resource === "plugins" && id === "marketplace" && method === "GET")
    return json(await marketplaceEntries());
  if (resource === "plugins" && method === "POST" && !id) {
    const b = await body();
    const projectId = text(b.agent, "project");
    projectsRepository(ctx).find(projectId);
    const slug = text(b.slug, "slug", 50);
    if (
      !/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(slug) ||
      pluginsRepository(ctx)
        .list()
        .some((p) => p.projectId === projectId && p.slug === slug)
    )
      throw new HttpError(400, "Invalid or already installed plugin.");
    const version = text(b.version, "version");
    const distribution = b.distribution ?? "inline";
    let source = "",
      metadata: any = {},
      packageUrl = "",
      hash = "";
    if (distribution === "inline") {
      source = sourceText(b.source);
      hash = digest(source);
    } else if (distribution === "external") {
      metadata = await catalogRelease(slug, version);
      packageUrl = metadata.package_url;
      hash = metadata.digest;
      validateContract(metadata.configuration_schema, b.configuration ?? {});
    } else throw new HttpError(400, "Invalid distribution.");
    if (b.credential) {
      const credential = credentialsRepository(ctx).find(b.credential);
      if (
        distribution === "external" &&
        credential.provider !== metadata.auth?.provider
      )
        throw new HttpError(400, "Credential provider does not match.");
    }
    return json(
      view(
        pluginsRepository(ctx).create({
          projectId,
          slug,
          version,
          description:
            distribution === "external"
              ? metadata.description
              : optionalDescription(b.description),
          source,
          digest: hash,
          enabled: booleanValue(b.enabled, true),
          credentialId: b.credential ?? null,
          configuration: jsonValue(b.configuration ?? {}, "Configuration"),
          releaseMetadata: metadata,
          packageUrl,
          distribution,
        }),
      ),
      201,
    );
  }
  if (
    resource === "plugins" &&
    id &&
    (method === "PATCH" || method === "PUT")
  ) {
    const p = pluginsRepository(ctx).find(id),
      b = await body();
    if (b.agent && b.agent !== p.projectId)
      throw new HttpError(400, "Reinstall plugins to move them.");
    if (b.distribution && b.distribution !== p.distribution)
      throw new HttpError(
        400,
        "Remove the plugin before changing its distribution.",
      );
    let metadata = p.releaseMetadata,
      source = p.source,
      hash = p.digest,
      packageUrl = p.packageUrl,
      description = optionalDescription(b.description, p.description);
    const version = b.version ?? p.version;
    if (p.distribution === "external") {
      if (b.source)
        throw new HttpError(
          400,
          "External plugin source is managed by its release.",
        );
      if (version !== p.version || b.refresh_bundle)
        metadata = await catalogRelease(p.slug, version);
      hash = metadata.digest ?? p.digest;
      packageUrl = metadata.package_url ?? p.packageUrl;
      description = metadata.description ?? p.description;
      validateContract(
        metadata.configuration_schema,
        b.configuration ?? p.configuration,
      );
    } else if (b.source !== undefined) {
      source = sourceText(b.source);
      if (source !== p.source && version === p.version)
        throw new HttpError(400, "Changed source requires a new version.");
      hash = digest(source);
    }
    if (b.credential) {
      const c = credentialsRepository(ctx).find(b.credential);
      if (
        p.distribution === "external" &&
        c.provider !== metadata.auth?.provider
      )
        throw new HttpError(400, "Credential provider does not match.");
    }
    return json(
      view(
        pluginsRepository(ctx).update(id, {
          version: text(version, "version"),
          description,
          source,
          digest: hash,
          packageUrl,
          releaseMetadata: metadata,
          enabled: booleanValue(b.enabled, p.enabled),
          credentialId:
            b.credential === undefined ? p.credentialId : b.credential,
          configuration: jsonValue(
            b.configuration ?? p.configuration,
            "Configuration",
          ),
        }),
      ),
    );
  }
  if (resource === "plugins" && id && method === "DELETE") {
    pluginsRepository(ctx).find(id);
    pluginsRepository(ctx).remove(id);
    return new Response(null, { status: 204 });
  }
  if (method === "GET" && !id)
    return json(page(pluginsRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(pluginsRepository(ctx).find(id)));
  return null;
}
