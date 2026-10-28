import { protectedProcedure } from "../procedures";
import { scope } from "../../domain/permissions";
import { requireWorkspace } from "../../shared/authorization";
import { ServiceError } from "../../shared/errors";
import { projectQueries } from "../../projects/queries";
import { projectIdSchema } from "../../projects/schemas";
import { serializeProject } from "../../projects/views";
export const getProcedure = protectedProcedure
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    scope(ctx, "catalog:read");
    const project = projectQueries(
      ctx.db,
      requireWorkspace(ctx).id,
    ).findVisible(input.id, ctx.token);
    if (!project) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return serializeProject(ctx, project);
  });
