import { and, eq, inArray } from "drizzle-orm";
import type { ServiceContext } from "../application";
import { mcpConnections, plugins, runs } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { ServiceError } from "../shared/errors";
import { now } from "../shared/records";
import {
  connectionSchema,
  discoverySchema,
} from "../../runtime/src/mcp/contract";
import { snapshotAgents } from "../projects/snapshot-schema";
import type { Run } from "../execution/authority";

export function mcpConnection(ctx: ServiceContext, id: string) {
  const workspaceId = requireWorkspace(ctx).id;
  const row = ctx.db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.pluginId, id),
        eq(mcpConnections.workspaceId, workspaceId),
      ),
    )
    .get();
  if (!row) {
    throw new ServiceError("NOT_FOUND", "MCP connection not found.");
  }
  return row;
}
export function mcpSnapshot(ctx: ServiceContext, id: string) {
  const row = mcpConnection(ctx, id);
  return connectionSchema.parse({
    id,
    endpoint: row.endpoint,
    transport: row.transport,
    revision: row.revision,
    tools: row.catalogue.filter((tool) => row.enabledTools.includes(tool.name)),
  });
}
export function cancelConnectionRuns(ctx: ServiceContext, id: string) {
  const active = ctx.db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, requireWorkspace(ctx).id),
        inArray(runs.status, ["queued", "running", "waiting_approval"]),
      ),
    )
    .all();
  for (const run of active) {
    if (
      !snapshotAgents(run.snapshot).some((agent) =>
        agent.plugins.some(
          (plugin) => plugin.distribution === "mcp" && plugin.mcp?.id === id,
        ),
      )
    ) {
      continue;
    }
    ctx.db
      .update(runs)
      .set({
        cancelRequested: true,
        ...(run.status === "queued" ? { status: "cancelled" } : {}),
        updatedAt: now(),
      })
      .where(eq(runs.id, run.id))
      .run();
  }
}
export function completeDiscovery(
  ctx: ServiceContext,
  run: Run,
  output: unknown,
  succeeded: boolean,
) {
  const target = connectionSchema.parse(run.snapshot.mcp_discovery);
  const connection = ctx.db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.pluginId, target.id),
        eq(mcpConnections.workspaceId, run.workspaceId),
      ),
    )
    .get();
  if (
    !connection ||
    connection.discoveryRunId !== run.id ||
    connection.revision !== target.revision ||
    connection.endpoint !== target.endpoint
  ) {
    return;
  }
  const result = succeeded ? discoverySchema.parse(output) : null;
  ctx.db
    .update(mcpConnections)
    .set({
      candidate: result,
      status: result
        ? result.authRequired
          ? "authentication_required"
          : "review_required"
        : "failed",
      checkedAt: now(),
    })
    .where(eq(mcpConnections.pluginId, target.id))
    .run();
}
export function assertMcpCredential(
  ctx: ServiceContext,
  run: Run,
  credentialId: string,
) {
  const connections = ctx.db
    .select({ id: plugins.id })
    .from(plugins)
    .where(
      and(
        eq(plugins.workspaceId, run.workspaceId),
        eq(plugins.projectId, run.projectId),
        eq(plugins.credentialId, credentialId),
        eq(plugins.distribution, "mcp"),
      ),
    )
    .all();
  if (
    !connections.some((row) =>
      snapshotAgents(run.snapshot).some((agent) =>
        agent.plugins.some(
          (plugin) =>
            plugin.distribution === "mcp" &&
            plugin.mcp?.id === row.id &&
            plugin.credential_id === credentialId,
        ),
      ),
    )
  ) {
    throw new ServiceError(
      "FORBIDDEN",
      "MCP credential binding changed. Start a new run.",
    );
  }
}
