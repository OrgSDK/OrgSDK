import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { AppContext } from "../http/context";
import { type Executor } from "./authority";
export function pluginsFor(ctx: AppContext, worker: Executor) {
  return ctx.store.db
    .select()
    .from(t.plugins)
    .where(
      and(
        eq(t.plugins.workspaceId, worker.workspaceId),
        eq(t.plugins.projectId, worker.projectId),
        eq(t.plugins.enabled, true),
      ),
    )
    .all()
    .map((plugin) => ({
      slug: plugin.slug,
      version: plugin.version,
      source: plugin.source,
      digest: plugin.digest,
      credential_id: plugin.credentialId,
      credential_provider: plugin.releaseMetadata?.auth?.provider ?? null,
      distribution: plugin.distribution,
      package_url: plugin.packageUrl,
      configuration: plugin.configuration,
      contract_version: 1,
    }));
}

export function configuration(ctx: AppContext, worker: Executor) {
  return {
    id: worker.id,
    pool: worker.pool,
    protocol_version: worker.protocolVersion,
    agent_id: worker.projectId,
    plugins: pluginsFor(ctx, worker),
  };
}
