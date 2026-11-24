import { z } from "zod";
import { inTransaction } from "../../db/transaction";
import {
  supportsShellPolicy,
  writeShellRule,
  executableName,
  ruleDecision,
} from "../../plugins/shell-policy";
import { assertCurrentPluginManager } from "../../plugins/validation";
import { pluginsRepository } from "../../repositories/plugins";
import { ServiceError } from "../../shared/errors";
import { browserManagerProcedure } from "../procedures";
export const setShellRuleProcedure = browserManagerProcedure
  .input(
    z.strictObject({
      id: z.uuid(),
      executable: executableName,
      decision: ruleDecision,
    }),
  )
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      assertCurrentPluginManager(transaction);
      const plugin = pluginsRepository(transaction).find(input.id);
      if (!supportsShellPolicy(plugin)) {
        throw new ServiceError(
          "BAD_REQUEST",
          "This plugin version does not support executable policies.",
        );
      }
      writeShellRule(transaction, plugin, input.executable, input.decision);
      return { saved: true };
    }),
  );
