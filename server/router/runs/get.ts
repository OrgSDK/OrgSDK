import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { runIdSchema } from "../../runs/schemas";
import { serializeRun } from "../../runs/views";
import { scopedProcedure } from "../procedures";

export const getProcedure = scopedProcedure("runs:read")
  .input(runIdSchema)
  .query(({ ctx, input }) => {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run, null);
    return serializeRun(ctx, run);
  });
