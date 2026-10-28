import { tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { rowView } from "../../tables/views";
import { updateRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { validateValues } from "../../shared/contracts";
import { rowInTable } from "../../tables/access";
import { browserWorkspaceProcedure } from "../procedures";

export const updateRowProcedure = browserWorkspaceProcedure
  .input(updateRowSchema)
  .mutation(({ ctx, input }) => {
    return rowView(
      tx(ctx, (ctx) => {
        const table = workspaceTablesRepository(ctx).find(input.id);
        checkRevision(table, input.table_revision);
        const row = rowInTable(ctx, input.id, input.rowId);
        checkRevision(row, input.revision);
        validateValues(table.columns, input.values);
        return tableRowsRepository(ctx).update(input.rowId, {
          values: input.values,
          revision: row.revision + 1,
        });
      }),
    );
  });
