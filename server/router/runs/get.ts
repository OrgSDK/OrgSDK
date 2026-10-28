import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { runIdSchema } from "../../runs/schemas";
import { serializeRun } from "../../runs/views";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(runIdSchema)
  .query(({ ctx, input }) => {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run);
    return serializeRun(ctx, run);
  });
