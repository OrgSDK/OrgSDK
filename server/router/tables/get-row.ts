import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableRowSchema } from "../../tables/schemas";
import { rowInTable } from "../../tables/access";
import { browserWorkspaceProcedure } from "../procedures";

export const getRowProcedure = browserWorkspaceProcedure
  .input(tableRowSchema)
  .query(({ ctx, input }) => {
    workspaceTablesRepository(ctx).find(input.id);
    return rowView(rowInTable(ctx, input.id, input.rowId));
  });
