import { assertCurrentPluginManager } from "../../../plugins/validation";
import { browserManagerProcedure } from "../../procedures";
import { and, eq, gt } from "drizzle-orm";
import { inTransaction } from "../../../db/transaction";
import { mcpConnections, executors, runs } from "../../../db/schema";
import { pluginIdSchema } from "../../../plugins/schemas";
import { mcpConnection, mcpSnapshot } from "../../../mcp/connections";
import { pluginsRepository } from "../../../repositories/plugins";
import { recordAudit } from "../../../repositories/audit";
import { base } from "../../../shared/records";
import { ServiceError } from "../../../shared/errors";

export const discoverProcedure = browserManagerProcedure
  .input(pluginIdSchema)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const plugin = pluginsRepository(transaction).find(input.id);
      const connection = mcpConnection(transaction, input.id);
      const workers = transaction.db
        .select()
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
        .all();
      if (!workers.length) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Connect this project's runner before checking the server.",
        );
      }
      if (
        !workers.some(
          (worker) =>
            worker.protocolVersion >= 4 &&
            worker.capabilities.includes("mcp_discover"),
        )
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Upgrade the project runner to support MCP connections.",
        );
      }
      if (connection.discoveryRunId) {
        const previous = transaction.db
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.id, connection.discoveryRunId),
              eq(runs.workspaceId, ctx.workspace.id),
            ),
          )
          .get();
        if (previous && ["queued", "running"].includes(previous.status)) {
          transaction.db
            .update(runs)
            .set({
              cancelRequested: true,
              ...(previous.status === "queued" ? { status: "cancelled" } : {}),
            })
            .where(eq(runs.id, previous.id))
            .run();
        }
      }
      const target = { ...mcpSnapshot(transaction, input.id), tools: [] };
      const run = transaction.db
        .insert(runs)
        .values({
          ...base(ctx.workspace.id),
          projectId: plugin.projectId,
          actorId: ctx.user.id,
          operation: "mcp_discover",
          idempotencyKey: crypto.randomUUID(),
          snapshot: {
            root_agent_id: plugin.projectId,
            mcp_discovery: target,
            agents: [
              {
                id: plugin.projectId,
                name: "MCP discovery",
                plugins: [
                  {
                    slug: plugin.slug,
                    version: plugin.version,
                    source: "",
                    digest: plugin.digest,
                    credential_id: plugin.credentialId,
                    distribution: "mcp",
                    mcp: target,
                  },
                ],
              },
            ],
          },
        })
        .returning()
        .get();
      transaction.db
        .update(mcpConnections)
        .set({ discoveryRunId: run.id, status: "checking", candidate: null })
        .where(eq(mcpConnections.pluginId, input.id))
        .run();
      recordAudit(transaction, "plugin", input.id, "discovery.requested");
      return { run: run.id };
    }),
  );
