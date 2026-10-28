import { and, eq } from "drizzle-orm";
import { workspaceTables } from "../../db/schema";
import { now } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { ServiceError } from "../../shared/errors";
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
        const table = ctx.db
          .update(workspaceTables)
          .set({
            name:
              input.name === undefined
                ? current.name
                : text(input.name, "name", 120),
            columns,
            revision: current.revision + 1,
            updatedAt: now(),
          })
          .where(
            and(
              eq(workspaceTables.workspaceId, ctx.workspace.id),
              eq(workspaceTables.id, input.id),
            ),
          )
          .returning()
          .get();
        if (!table) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(ctx, "table", table.id, "updated");
        return table;
      }),
    );
  });
