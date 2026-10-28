import { browser, tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { rowView } from "../../tables/views";
import { updateRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { validateValues } from "../../shared/contracts";
import { rowInTable } from "../../tables/access";
import { protectedProcedure } from "../procedures";

export const updateRowProcedure = protectedProcedure
  .input(updateRowSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx);
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
