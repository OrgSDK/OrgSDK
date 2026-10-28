import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { createTableSchema } from "../../tables/schemas";
import { text } from "../../shared/validation";
import { validateColumns } from "../../shared/contracts";
import { browserManagerProcedure } from "../procedures";

export const createProcedure = browserManagerProcedure
  .input(createTableSchema)
  .mutation(({ ctx, input }) => {
    return standard(
      workspaceTablesRepository(ctx).create({
        name: text(input.name, "name", 120),
        columns: validateColumns(input.columns),
        revision: 1,
      }),
    );
  });
