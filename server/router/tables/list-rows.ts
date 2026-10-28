import { tableQueries } from "../../tables/queries";
import { browser, workspace } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listRowsProcedure = protectedProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    workspaceTablesRepository(ctx).find(input.id);
    return page(
      tableQueries(ctx.db, workspace(ctx)).rowsForTable(input.id).map(rowView),
    );
  });
