import { protectedProcedure } from "../procedures";
import { browser, tx } from "../../domain/permissions";
import { requireWorkspace } from "../../shared/authorization";
import { ServiceError } from "../../shared/errors";
import { projectIdSchema } from "../../projects/schemas";
import { projectQueries } from "../../projects/queries";
import { projectsRepository } from "../../repositories/projects";
export const deleteProcedure = protectedProcedure
  .input(projectIdSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    tx(ctx, (transaction) => {
      const projects = projectsRepository(transaction);
      projects.find(input.id);
      if (
        projectQueries(
          transaction.db,
          requireWorkspace(transaction).id,
        ).hasRetainedResources(input.id)
      ) {
        throw new ServiceError(
          "CONFLICT",
          "Project has retained runs or actions.",
        );
      }
      projects.remove(input.id);
    });
  });
