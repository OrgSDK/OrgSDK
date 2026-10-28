import { auditQueries } from "../../audit/queries";
import { auditFiltersSchema } from "../../audit/schemas";
import { auditView } from "../../audit/views";
import { page } from "../../shared/pagination";
import { browserManagerProcedure } from "../procedures";

export const listProcedure = browserManagerProcedure
  .input(auditFiltersSchema.optional().default({}))
  .query(({ ctx, input }) => {
    const queries = auditQueries(ctx.db, ctx.workspace.id);
    return page(
      queries
        .list(input)
        .map((record) => auditView(record, queries.actor(record.actorId))),
    );
  });
