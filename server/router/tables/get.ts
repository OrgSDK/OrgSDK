import { browser } from "../../domain/permissions";
import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    browser(ctx);
    return standard(workspaceTablesRepository(ctx).find(input.id));
  });
