import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { shellRules } from "../../db/schema";
import { supportsShellPolicy } from "../../plugins/shell-policy";
import { pluginsRepository } from "../../repositories/plugins";
import { ServiceError } from "../../shared/errors";
import { browserWorkspaceProcedure } from "../procedures";
export const shellRulesProcedure = browserWorkspaceProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    const plugin = pluginsRepository(ctx).find(input.id);
    if (!supportsShellPolicy(plugin)) {
      throw new ServiceError(
        "BAD_REQUEST",
        "This plugin version does not support executable policies.",
      );
    }
    return ctx.db
      .select({
        executable: shellRules.executable,
        decision: shellRules.decision,
      })
      .from(shellRules)
      .where(eq(shellRules.pluginId, plugin.id))
      .orderBy(asc(shellRules.executable))
      .all();
  });
