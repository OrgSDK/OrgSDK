import { browser } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableRowSchema } from "../../tables/schemas";
import { rowInTable } from "../../tables/access";
import { protectedProcedure } from "../procedures";

export const getRowProcedure = protectedProcedure
  .input(tableRowSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    workspaceTablesRepository(ctx).find(input.id);
    return rowView(rowInTable(ctx, input.id, input.rowId));
  });
