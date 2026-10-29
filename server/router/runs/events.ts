import { authorizeRunRead } from "../../domain/permissions";
import { runsRepository } from "../../repositories/runs";
import { and, asc, eq } from "drizzle-orm";
import { runEvents } from "../../db/schema";
import { runIdSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";

export const eventsProcedure = scopedProcedure("runs:read")
  .input(runIdSchema)
  .query(({ ctx, input }) => {
    const run = runsRepository(ctx).find(input.id);
    authorizeRunRead(ctx, run, null);
    const events = ctx.db
      .select()
      .from(runEvents)
      .where(
        and(
          eq(runEvents.workspaceId, ctx.workspace.id),
          eq(runEvents.runId, input.id),
        ),
      )
      .orderBy(asc(runEvents.sequence))
      .all();
    return events.map((event) => ({
      sequence: event.sequence,
      kind: event.kind,
      data: event.data,
      created_at: event.createdAt,
    }));
  });
