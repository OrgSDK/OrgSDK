import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { inTransaction } from "../../db/transaction";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginIdSchema } from "../../plugins/schemas";
import { assertCurrentPluginManager } from "../../plugins/validation";
export const deleteProcedure = protectedProcedure
  .input(pluginIdSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      pluginsRepository(transaction).find(input.id);
      pluginsRepository(transaction).remove(input.id);
    });
  });
