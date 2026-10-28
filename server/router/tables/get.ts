import { findWorkspaceTable } from "../../repositories/workspace-tables";
import { standard } from "../../tables/views";
import { tableIdSchema } from "../../tables/schemas";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(tableIdSchema)
  .query(({ ctx, input }) => {
    return standard(findWorkspaceTable(ctx.db, ctx.workspace.id, input.id));
  });
