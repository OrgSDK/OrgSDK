import { scopedProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { projectQueries } from "../../projects/queries";
import { projectIdSchema } from "../../projects/schemas";
import { serializeProject } from "../../projects/views";
export const getProcedure = scopedProcedure("catalog:read")
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    const project = projectQueries(ctx.db, ctx.workspace.id).findVisible(
      input.id,
      ctx.token,
    );
    if (!project) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return serializeProject(ctx, project);
  });
