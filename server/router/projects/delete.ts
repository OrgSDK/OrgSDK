import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { projectIdSchema } from "../../projects/schemas";
import { projectQueries } from "../../projects/queries";
import { projectsRepository } from "../../repositories/projects";
export const deleteProcedure = browserManagerProcedure
  .input(projectIdSchema)
  .mutation(({ ctx, input }) => {
    tx(ctx, (transaction) => {
      const projects = projectsRepository(transaction);
      projects.find(input.id);
      if (
        projectQueries(transaction.db, ctx.workspace.id).hasRetainedResources(
          input.id,
        )
      ) {
        throw new ServiceError(
          "CONFLICT",
          "Project has retained runs or actions.",
        );
      }
      projects.remove(input.id);
    });
  });
