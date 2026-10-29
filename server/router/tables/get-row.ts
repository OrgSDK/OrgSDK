import { findWorkspaceTable } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableRowSchema } from "../../tables/schemas";
import { rowInTable } from "../../tables/access";
import { browserWorkspaceProcedure } from "../procedures";

export const getRowProcedure = browserWorkspaceProcedure
  .input(tableRowSchema)
  .query(({ ctx, input }) => {
    findWorkspaceTable(ctx.db, ctx.workspace.id, input.id);
    return rowView(rowInTable(ctx.db, ctx.workspace.id, input.id, input.rowId));
  });
