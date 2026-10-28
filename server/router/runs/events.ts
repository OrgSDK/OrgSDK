import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { runEventsFor } from "../../runs/queries";
import { runIdSchema } from "../../runs/schemas";
import { protectedProcedure } from "../procedures";

export const eventsProcedure = protectedProcedure
  .input(runIdSchema)
  .query(({ ctx, input }) => {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run);
    return runEventsFor(ctx, input.id).map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      data: event.data,
      created_at: event.createdAt,
    }));
  });
