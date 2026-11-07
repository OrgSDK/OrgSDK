import { assertCurrentPluginManager } from "../../../plugins/validation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { browserManagerProcedure } from "../../procedures";
import { inTransaction } from "../../../db/transaction";
import { mcpConnections, plugins } from "../../../db/schema";
import { cancelConnectionRuns, mcpConnection } from "../../../mcp/connections";
import { approveTools } from "../../../../runtime/src/mcp/aliases";
import { recordAudit } from "../../../repositories/audit";
import { now } from "../../../shared/records";
import { digest } from "../../../shared/security";
import { ServiceError } from "../../../shared/errors";

export const acceptProcedure = browserManagerProcedure
  .input(
    z.strictObject({
      id: z.uuid(),
      run: z.uuid(),
      tools: z.array(z.string()).max(1000),
    }),
  )
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const connection = mcpConnection(transaction, input.id);
      if (
        !connection.candidate ||
        connection.candidate.authRequired ||
        connection.discoveryRunId !== input.run
      ) {
        throw new ServiceError(
          "CONFLICT",
          "Check this server again before accepting its tools.",
        );
      }
      const selected = new Set(input.tools);
      if (
        selected.size !== input.tools.length ||
        input.tools.some(
          (name) =>
            !connection.candidate?.tools.some((tool) => tool.name === name),
        )
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Select tools from the checked catalogue.",
        );
      }
      const history = Object.entries(connection.aliases).map(
        ([name, alias]) => ({ name, alias }),
      );
      const catalogue = approveTools(connection.candidate.tools, history);
      const revision = connection.revision + 1;
      if (connection.enabledTools.some((name) => !selected.has(name))) {
        cancelConnectionRuns(transaction, input.id);
      }
      transaction.db
        .update(mcpConnections)
        .set({
          catalogue,
          aliases: {
            ...connection.aliases,
            ...Object.fromEntries(
              catalogue.map((tool) => [tool.name, tool.alias]),
            ),
          },
          enabledTools: input.tools,
          candidate: null,
          revision,
          status: "ready",
        })
        .where(eq(mcpConnections.pluginId, input.id))
        .run();
      transaction.db
        .update(plugins)
        .set({
          version: String(revision),
          digest: digest(JSON.stringify(catalogue)),
          enabled: selected.size > 0,
          updatedAt: now(),
        })
        .where(eq(plugins.id, input.id))
        .run();
      recordAudit(transaction, "plugin", input.id, "catalogue.accepted");
      return { id: input.id, revision };
    }),
  );
