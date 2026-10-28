import { browserWorkspaceProcedure } from "../procedures";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginIdSchema } from "../../plugins/schemas";
import { pluginView } from "../../plugins/views";
export const getProcedure = browserWorkspaceProcedure
  .input(pluginIdSchema)
  .query(({ ctx, input }) => {
    return pluginView(pluginsRepository(ctx).find(input.id));
  });
