import { protectedProcedure } from "../procedures";
import { browser, tx } from "../../domain/permissions";
import { projectChangesSchema } from "../../projects/schemas";
import { projectValues } from "../../projects/validation";
import { serializeProject } from "../../projects/views";
import { projectsRepository } from "../../repositories/projects";
export const updateProcedure = protectedProcedure
  .input(projectChangesSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    const { id, ...changes } = input;
    return tx(ctx, (transaction) => {
      const projects = projectsRepository(transaction);
      return serializeProject(
        transaction,
        projects.update(
          id,
          projectValues(transaction, changes, projects.find(id)),
        ),
      );
    });
  });
