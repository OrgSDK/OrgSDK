import { tx } from "../../domain/permissions";
import { findWorkspaceTable } from "../../repositories/workspace-tables";
import { removeTableRow } from "../../repositories/table-rows";
import { deleteRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { rowInTable } from "../../tables/access";
import { browserWorkspaceProcedure } from "../procedures";

export const deleteRowProcedure = browserWorkspaceProcedure
  .input(deleteRowSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (ctx) => {
      findWorkspaceTable(ctx.db, ctx.workspace.id, input.id);
      checkRevision(
        rowInTable(ctx.db, ctx.workspace.id, input.id, input.rowId),
        input.revision,
      );
      removeTableRow(ctx, input.rowId);
      return { deleted: true };
    });
  });
