import { and, eq } from "drizzle-orm";
import { auditRecords } from "../../db/schema";
import { ServiceError } from "../../shared/errors";
import { z } from "zod";
import { auditQueries } from "../../audit/queries";
import { auditView } from "../../audit/views";
import { browserManagerProcedure } from "../procedures";

export const getProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    const record = ctx.db
      .select()
      .from(auditRecords)
      .where(
        and(
          eq(auditRecords.workspaceId, ctx.workspace.id),
          eq(auditRecords.id, input.id),
        ),
      )
      .get();
    if (!record) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    const actor = auditQueries(ctx.db, ctx.workspace.id).actor(record.actorId);
    return auditView(record, actor);
  });
