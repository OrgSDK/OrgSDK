import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginIdSchema } from "../../plugins/schemas";
import { pluginView } from "../../plugins/views";
export const getProcedure = protectedProcedure
  .input(pluginIdSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    return pluginView(pluginsRepository(ctx).find(input.id));
  });
