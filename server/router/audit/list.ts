import { and, desc, eq, gte, lt } from "drizzle-orm";
import { auditRecords } from "../../db/schema";
import { auditQueries } from "../../audit/queries";
import { auditFiltersSchema } from "../../audit/schemas";
import { auditView } from "../../audit/views";
import { page } from "../../shared/pagination";
import { browserManagerProcedure } from "../procedures";

export const listProcedure = browserManagerProcedure
  .input(auditFiltersSchema.optional().default({}))
  .query(({ ctx, input }) => {
    const queries = auditQueries(ctx.db, ctx.workspace.id);
    const records = ctx.db
      .select()
      .from(auditRecords)
      .where(
        and(
          eq(auditRecords.workspaceId, ctx.workspace.id),
          input.actor === undefined
            ? undefined
            : eq(auditRecords.actorId, input.actor),
          input.kind === undefined
            ? undefined
            : eq(auditRecords.action, input.kind),
          input.object_id === undefined
            ? undefined
            : eq(auditRecords.resource, input.object_id),
          input.since === undefined
            ? undefined
            : gte(auditRecords.createdAt, input.since),
          input.before === undefined
            ? undefined
            : lt(auditRecords.createdAt, input.before),
        ),
      )
      .orderBy(desc(auditRecords.createdAt))
      .all();
    return page(
      records.map((record) => auditView(record, queries.actor(record.actorId))),
    );
  });
