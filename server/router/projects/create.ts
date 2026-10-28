import { protectedProcedure } from "../procedures";
import { browser, tx } from "../../domain/permissions";
import { projectCreateSchema } from "../../projects/schemas";
import { projectValues } from "../../projects/validation";
import { serializeProject } from "../../projects/views";
import { projectsRepository } from "../../repositories/projects";
export const createProcedure = protectedProcedure
  .input(projectCreateSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    return tx(ctx, (transaction) =>
      serializeProject(
        transaction,
        projectsRepository(transaction).create(
          projectValues(transaction, input),
        ),
      ),
    );
  });
