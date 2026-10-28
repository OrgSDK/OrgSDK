import { runTestsSchema } from "../../actions/schemas";
import { protectedProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import { createRun } from "../../runs/create";
import { serializeRun } from "../../runs/views";

export const runTestsProcedure = protectedProcedure
  .input(runTestsSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(body.id);
      return serializeRun(
        ctx,
        createRun(ctx, {
          ...body,
          project: action.projectId,
          action: action.id,
          operation: "test",
        }),
      );
    });
  });
