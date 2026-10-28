import { z } from "zod";
import { auditQueries } from "../../audit/queries";
import { auditView } from "../../audit/views";
import { auditRecordsRepository } from "../../repositories/audit-records";
import { browserManagerProcedure } from "../procedures";

export const getProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    const record = auditRecordsRepository(ctx).find(input.id);
    const actor = auditQueries(ctx.db, ctx.workspace.id).actor(record.actorId);
    return auditView(record, actor);
  });
