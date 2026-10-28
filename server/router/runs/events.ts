import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { runEventsFor } from "../../runs/queries";
import { runIdSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";

export const eventsProcedure = scopedProcedure("runs:read")
  .input(runIdSchema)
  .query(({ ctx, input }) => {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run, null);
    return runEventsFor(ctx, input.id).map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      data: event.data,
      created_at: event.createdAt,
    }));
  });
