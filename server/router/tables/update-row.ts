import { and, eq } from "drizzle-orm";
import { tableRows } from "../../db/schema";
import { now } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { ServiceError } from "../../shared/errors";
import { tx } from "../../domain/permissions";
import { findWorkspaceTable } from "../../repositories/workspace-tables";
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
        const table = findWorkspaceTable(ctx.db, ctx.workspace.id, input.id);
        checkRevision(table, input.table_revision);
        const row = rowInTable(ctx.db, ctx.workspace.id, input.id, input.rowId);
        checkRevision(row, input.revision);
        validateValues(table.columns, input.values);
        const updatedRow = ctx.db
          .update(tableRows)
          .set({
            values: input.values,
            revision: row.revision + 1,
            updatedAt: now(),
          })
          .where(
            and(
              eq(tableRows.workspaceId, ctx.workspace.id),
              eq(tableRows.id, input.rowId),
            ),
          )
          .returning()
          .get();
        if (!updatedRow) {
          throw new ServiceError("NOT_FOUND", "Not found.");
        }
        recordAudit(ctx, "row", updatedRow.id, "updated");
        return updatedRow;
      }),
    );
  });
