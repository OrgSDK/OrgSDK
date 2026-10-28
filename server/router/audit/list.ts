import { auditQueries } from "../../audit/queries";
import { auditFiltersSchema } from "../../audit/schemas";
import { auditView } from "../../audit/views";
import { browser, workspace } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure
  .input(auditFiltersSchema.optional().default({}))
  .query(({ ctx, input }) => {
    browser(ctx, true);
    const queries = auditQueries(ctx.db, workspace(ctx));
    return page(
      queries
        .list(input)
        .map((record) => auditView(record, queries.actor(record.actorId))),
    );
  });
