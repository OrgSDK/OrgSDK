import { tableQueries } from "../../tables/queries";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listRowsProcedure = browserWorkspaceProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    workspaceTablesRepository(ctx).find(input.id);
    return page(
      tableQueries(ctx.db, ctx.workspace.id)
        .rowsForTable(input.id)
        .map(rowView),
    );
  });
