import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginView } from "../../plugins/views";
export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(pluginsRepository(ctx).list().map(pluginView));
});
