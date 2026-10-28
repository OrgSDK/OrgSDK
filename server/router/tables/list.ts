import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  return page(workspaceTablesRepository(ctx).list().map(standard));
});
