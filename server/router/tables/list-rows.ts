import { rowsForTable } from "../../tables/queries";
import { findWorkspaceTable } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listRowsProcedure = browserWorkspaceProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    findWorkspaceTable(ctx.db, ctx.workspace.id, input.id);
    return page(rowsForTable(ctx.db, ctx.workspace.id, input.id).map(rowView));
  });
