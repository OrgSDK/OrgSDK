import { browser } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { createTableSchema } from "../../tables/schemas";
import { text } from "../../shared/validation";
import { validateColumns } from "../../shared/contracts";
import { protectedProcedure } from "../procedures";

export const createProcedure = protectedProcedure
  .input(createTableSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    return standard(
      workspaceTablesRepository(ctx).create({
        name: text(input.name, "name", 120),
        columns: validateColumns(input.columns),
        revision: 1,
      }),
    );
  });
