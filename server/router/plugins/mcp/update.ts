import { assertCurrentPluginManager } from "../../../plugins/validation";
import { browserManagerProcedure } from "../../procedures";
import { eq } from "drizzle-orm";
import { inTransaction } from "../../../db/transaction";
import { mcpConnections, plugins } from "../../../db/schema";
import { connectionUpdate } from "../../../mcp/schemas";
import { cancelConnectionRuns, mcpConnection } from "../../../mcp/connections";
import { createHeaderCredential } from "../../../mcp/headers";
import { recordAudit } from "../../../repositories/audit";
import { ServiceError } from "../../../shared/errors";
import { now } from "../../../shared/records";

export const updateProcedure = browserManagerProcedure
  .input(connectionUpdate)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const connection = mcpConnection(transaction, input.id);
      const endpoint = input.endpoint ?? connection.endpoint;
      const authMode = input.auth_mode ?? connection.authMode;
      const credentialId =
        authMode === "headers" && input.headers
          ? createHeaderCredential(transaction, input.id, input.headers)
          : undefined;
      const resetAuth =
        endpoint !== connection.endpoint || authMode !== connection.authMode;
      if (resetAuth && authMode === "headers" && !credentialId) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Enter replacement authentication headers for this endpoint.",
        );
      }
      cancelConnectionRuns(transaction, input.id);
      transaction.db
        .update(mcpConnections)
        .set({
          endpoint,
          transport: input.transport ?? connection.transport,
          authMode,
          revision: connection.revision + 1,
          candidate: null,
          status: "unchecked",
          discoveryRunId: null,
          catalogue: [],
          enabledTools: [],
        })
        .where(eq(mcpConnections.pluginId, input.id))
        .run();
      transaction.db
        .update(plugins)
        .set({
          enabled: false,
          ...(credentialId
            ? { credentialId }
            : resetAuth
              ? { credentialId: null }
              : {}),
          updatedAt: now(),
        })
        .where(eq(plugins.id, input.id))
        .run();
      recordAudit(transaction, "plugin", input.id, "connection.updated");
      return { id: input.id };
    }),
  );
