import { and, eq } from "drizzle-orm";
import { projects } from "../../db/schema";
import { scopedProcedure } from "../procedures";
import { ServiceError } from "../../shared/errors";
import { projectVisibility } from "../../projects/queries";
import { projectIdSchema } from "../../projects/schemas";
import { serializeProject } from "../../projects/views";
export const getProcedure = scopedProcedure("catalog:read")
  .input(projectIdSchema)
  .query(({ ctx, input }) => {
    const project = ctx.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, ctx.workspace.id),
          eq(projects.id, input.id),
          projectVisibility(ctx.db, ctx.workspace.id, ctx.token),
        ),
      )
      .get();
    if (!project) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return serializeProject(ctx, project);
  });
