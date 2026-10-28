import { browser } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  browser(ctx);
  return page(workspaceTablesRepository(ctx).list().map(standard));
});
