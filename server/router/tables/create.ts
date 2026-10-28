import { workspaceTables } from "../../db/schema";
import { inTransaction } from "../../db/transaction";
import { standard } from "../../tables/views";
import { createTableSchema } from "../../tables/schemas";
import { recordAudit } from "../../repositories/audit";
import { base } from "../../shared/records";
import { text } from "../../shared/validation";
import { validateColumns } from "../../shared/contracts";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(createTableSchema)
  .mutation(({ ctx, input }) =>
    inTransaction(ctx, (transaction) => {
      const table = transaction.db
        .insert(workspaceTables)
        .values({
          name: text(input.name, "name", 120),
          columns: validateColumns(input.columns),
          revision: 1,
          ...base(ctx.workspace.id),
        })
        .returning()
        .get();
      recordAudit(transaction, "table", table.id, "created");
      return standard(table);
    }),
  );
