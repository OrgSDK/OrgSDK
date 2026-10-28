import { browserManagerProcedure } from "../procedures";
import { projectIdSchema } from "../../projects/schemas";
import { tx } from "../../domain/permissions";
import { projectsRepository } from "../../repositories/projects";
import { revokeExecutor } from "../../projects/executor";
export const disconnectExecutorProcedure = browserManagerProcedure
  .input(projectIdSchema)
  .mutation(({ ctx, input }) => {
    projectsRepository(ctx).find(input.id);
    tx(ctx, (transaction) => revokeExecutor(transaction, input.id));
  });
