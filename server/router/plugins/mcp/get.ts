import { browserWorkspaceProcedure } from "../../procedures";
import { pluginIdSchema } from "../../../plugins/schemas";
import { mcpConnection } from "../../../mcp/connections";
import { and, eq, gt } from "drizzle-orm";
import { executors, runs, plugins } from "../../../db/schema";

export const getProcedure = browserWorkspaceProcedure
  .input(pluginIdSchema)
  .query(({ ctx, input }) => {
    const connection = mcpConnection(ctx, input.id);
    const plugin = ctx.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, connection.pluginId))
      .get();
    const runner = plugin
      ? ctx.db
          .select({ protocolVersion: executors.protocolVersion })
          .from(executors)
          .where(
            and(
              eq(executors.workspaceId, ctx.workspace.id),
              eq(executors.projectId, plugin.projectId),
              eq(executors.enabled, true),
              gt(
                executors.lastSeenAt,
                new Date(Date.now() - 60_000).toISOString(),
              ),
            ),
          )
          .all()
      : [];
    const run = connection.discoveryRunId
      ? ctx.db
          .select({ status: runs.status, error: runs.error })
          .from(runs)
          .where(
            and(
              eq(runs.id, connection.discoveryRunId),
              eq(runs.workspaceId, ctx.workspace.id),
            ),
          )
          .get()
      : undefined;
    return {
      ...connection,
      status:
        connection.status === "checking" &&
        run &&
        ["failed", "cancelled"].includes(run.status)
          ? "failed"
          : connection.status,
      authenticated: !!plugin?.credentialId,
      runner: runner.some((entry) => entry.protocolVersion >= 4)
        ? "ready"
        : runner.length
          ? "upgrade_required"
          : "offline",
      discovery: run ?? null,
    };
  });
