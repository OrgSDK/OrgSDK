import { tableQueries } from "../../tables/queries";
import { tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { updateTableSchema } from "../../tables/schemas";
import { checkRevision, text } from "../../shared/validation";
import { validateColumns, validateValues } from "../../shared/contracts";
import { browserManagerProcedure } from "../procedures";

export const updateProcedure = browserManagerProcedure
  .input(updateTableSchema)
  .mutation(({ ctx, input }) => {
    return standard(
      tx(ctx, (ctx) => {
        const current = workspaceTablesRepository(ctx).find(input.id);
        checkRevision(current, input.revision);
        const columns = validateColumns(input.columns ?? current.columns);
        for (const row of tableQueries(ctx.db, ctx.workspace.id).rowsForTable(
          input.id,
        )) {
          validateValues(columns, row.values);
        }
        return workspaceTablesRepository(ctx).update(input.id, {
          name:
            input.name === undefined
              ? current.name
              : text(input.name, "name", 120),
          columns,
          revision: current.revision + 1,
        });
      }),
    );
  });
