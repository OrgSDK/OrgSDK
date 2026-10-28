import { browser, tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { tableRowsRepository } from "../../repositories/table-rows";
import { rowView } from "../../tables/views";
import { createRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { validateValues } from "../../shared/contracts";
import { protectedProcedure } from "../procedures";

export const createRowProcedure = protectedProcedure
  .input(createRowSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx);
    return rowView(
      tx(ctx, (ctx) => {
        const table = workspaceTablesRepository(ctx).find(input.id);
        checkRevision(table, input.table_revision);
        validateValues(table.columns, input.values);
        return tableRowsRepository(ctx).create({
          tableId: input.id,
          values: input.values,
          revision: 1,
        });
      }),
    );
  });
