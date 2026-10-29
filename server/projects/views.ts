import { eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import { type ServiceContext } from "../application";
import { executorsRepository } from "../repositories/executors";
import { pluginsRepository } from "../repositories/plugins";
export function serializeProject(
  ctx: ServiceContext,
  row: typeof resourceTables.projects.$inferSelect,
) {
  const executor = executorsRepository(ctx).list(
    eq(resourceTables.executors.projectId, row.id),
  )[0];
  const pluginIds = pluginsRepository(ctx)
    .list(eq(resourceTables.plugins.projectId, row.id))
    .map((plugin) => plugin.id);
  const minimal = {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    runner: {
      registered: !!executor,
      enabled: !!executor?.enabled,
      locally_managed: !!executor?.locallyManaged,
      last_seen_at: executor?.lastSeenAt ?? null,
      protocol_version: executor?.protocolVersion ?? null,
    },
  };
  if (ctx.token) {
    return minimal;
  }
  return {
    ...minimal,
    plugins: pluginIds,
    readable_tables: row.readableTables,
    writable_tables: row.writableTables,
    readable_documents: row.readableDocuments,
    writable_documents: row.writableDocuments,
  };
}
