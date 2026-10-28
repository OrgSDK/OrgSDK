import { tableRows } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { tx } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { rowView } from "../../tables/views";
import { createRowSchema } from "../../tables/schemas";
import { checkRevision } from "../../shared/validation";
import { validateValues } from "../../shared/contracts";
import { browserWorkspaceProcedure } from "../procedures";

export const createRowProcedure = browserWorkspaceProcedure
  .input(createRowSchema)
  .mutation(({ ctx, input }) => {
    return rowView(
      tx(ctx, (ctx) => {
        const table = workspaceTablesRepository(ctx).find(input.id);
        checkRevision(table, input.table_revision);
        validateValues(table.columns, input.values);
        const row = ctx.db
          .insert(tableRows)
          .values({
            ...base(ctx.workspace.id),
            tableId: input.id,
            values: input.values,
            revision: 1,
          })
          .returning()
          .get();
        recordAudit(ctx, "row", row.id, "created");
        return row;
      }),
    );
  });
