import { protectedProcedure } from "../procedures";
import { projectIdSchema } from "../../projects/schemas";
import { browser, tx } from "../../domain/permissions";
import { projectsRepository } from "../../repositories/projects";
import { revokeExecutor } from "../../projects/executor";
export const disconnectExecutorProcedure = protectedProcedure
  .input(projectIdSchema)
  .mutation(({ ctx, input }) => {
    browser(ctx, true);
    projectsRepository(ctx).find(input.id);
    tx(ctx, (transaction) => revokeExecutor(transaction, input.id));
  });
