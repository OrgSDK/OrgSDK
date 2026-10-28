import { workspaceTablesRepository } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    return standard(workspaceTablesRepository(ctx).find(input.id));
  });
