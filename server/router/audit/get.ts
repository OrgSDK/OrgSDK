import { z } from "zod";
import { auditQueries } from "../../audit/queries";
import { auditView } from "../../audit/views";
import { browser, workspace } from "../../domain/permissions";
import { auditRecordsRepository } from "../../repositories/audit-records";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    browser(ctx, true);
    const record = auditRecordsRepository(ctx).find(input.id);
    const actor = auditQueries(ctx.db, workspace(ctx)).actor(record.actorId);
    return auditView(record, actor);
  });
