import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { pluginsRepository } from "../../repositories/plugins";
import { pluginView } from "../../plugins/views";
export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(pluginsRepository(ctx).list().map(pluginView));
});
