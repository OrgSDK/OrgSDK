import { and, eq } from "drizzle-orm";
import { credentialQueries } from "../../credentials/queries";
import { credentials, plugins } from "../../db/schema";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialIdSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { browserManagerProcedure } from "../procedures";

export const deleteProcedure = browserManagerProcedure
  .input(credentialIdSchema)
  .mutation(({ ctx, input }) => {
    inTransaction(ctx, (transaction) => {
      const queries = credentialQueries(transaction.db, ctx.workspace.id);
      if (!queries.findById(input.id)) {
        throw new ServiceError("NOT_FOUND", "Credential not found.");
      }
      const dependentPlugin = transaction.db
        .select({ id: plugins.id })
        .from(plugins)
        .where(
          and(
            eq(plugins.workspaceId, ctx.workspace.id),
            eq(plugins.credentialId, input.id),
          ),
        )
        .limit(1)
        .get();
      if (dependentPlugin) {
        throw new ServiceError("CONFLICT", "Credential is used by a plugin.");
      }
      transaction.db
        .delete(credentials)
        .where(
          and(
            eq(credentials.workspaceId, ctx.workspace.id),
            eq(credentials.id, input.id),
          ),
        )
        .run();
      recordAudit(transaction, "credential", input.id, "deleted");
    });
  });
