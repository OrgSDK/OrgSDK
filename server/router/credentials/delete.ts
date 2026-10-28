import { credentialQueries } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialIdSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { browserManagerProcedure } from "../procedures";

export const deleteProcedure = browserManagerProcedure
  .input(credentialIdSchema)
  .mutation(({ ctx, input }) => {
    const workspaceId = ctx.workspace.id;
    inTransaction(ctx, (ctx) => {
      const queries = credentialQueries(ctx.db, workspaceId);
      if (!queries.findById(input.id)) {
        throw new ServiceError("NOT_FOUND", "Credential not found.");
      }
      if (queries.isUsedByPlugin(input.id)) {
        throw new ServiceError("CONFLICT", "Credential is used by a plugin.");
      }
      queries.remove(input.id);
      recordAudit(ctx, "credential", input.id, "deleted");
    });
  });
