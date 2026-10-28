import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { projectCreateSchema } from "../../projects/schemas";
import { projectValues } from "../../projects/validation";
import { serializeProject } from "../../projects/views";
import { projectsRepository } from "../../repositories/projects";
export const createProcedure = browserManagerProcedure
  .input(projectCreateSchema)
  .mutation(({ ctx, input }) => {
    return tx(ctx, (transaction) =>
      serializeProject(
        transaction,
        projectsRepository(transaction).create(
          projectValues(transaction, input),
        ),
      ),
    );
  });
