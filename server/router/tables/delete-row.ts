import { tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { deleteRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { rowInTable } from "../../tables/access";
import { browserWorkspaceProcedure } from "../procedures";

export const deleteRowProcedure = browserWorkspaceProcedure
  .input(deleteRowSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      workspaceTablesRepository(ctx).find(input.id);
      checkRevision(rowInTable(ctx, input.id, input.rowId), input.revision);
      tableRowsRepository(ctx).remove(input.rowId);
      return { deleted: true };
    });
  });
