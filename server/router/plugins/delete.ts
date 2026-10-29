import { browserManagerProcedure } from "../procedures";
import { and, eq } from "drizzle-orm";
import { inTransaction } from "../../db/transaction";
import { plugins } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { ServiceError } from "../../shared/errors";
import { pluginIdSchema } from "../../plugins/schemas";
import { assertCurrentPluginManager } from "../../plugins/validation";
export const deleteProcedure = browserManagerProcedure
  .input(pluginIdSchema)
  .mutation(({ ctx, input }) => {
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const deletedPlugin = transaction.db
        .delete(plugins)
        .where(
          and(
            eq(plugins.workspaceId, ctx.workspace.id),
            eq(plugins.id, input.id),
          ),
        )
        .returning({ id: plugins.id })
        .get();
      if (!deletedPlugin) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(transaction, "plugin", input.id, "deleted");
    });
  });
