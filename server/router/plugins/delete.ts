import { browserManagerProcedure } from "../procedures";
import { inTransaction } from "../../db/transaction";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginIdSchema } from "../../plugins/schemas";
import { assertCurrentPluginManager } from "../../plugins/validation";
export const deleteProcedure = browserManagerProcedure
  .input(pluginIdSchema)
  .mutation(({ ctx, input }) => {
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      pluginsRepository(transaction).find(input.id);
      pluginsRepository(transaction).remove(input.id);
    });
  });
