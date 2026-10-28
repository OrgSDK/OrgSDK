import { and, eq } from "drizzle-orm";
import { schedules } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { browserWorkspaceProcedure } from "../procedures";
import { z } from "zod";
import { inTransaction } from "../../db/transaction";
import { ServiceError } from "../../shared/errors";

export const deleteProcedure = browserWorkspaceProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .mutation(({ ctx: context, input }) => {
    const id = input.id;

    return inTransaction(context, (context) => {
      const deleted = context.db
        .delete(schedules)
        .where(
          and(
            eq(schedules.workspaceId, context.workspace.id),
            eq(schedules.id, id),
          ),
        )
        .returning({ id: schedules.id })
        .get();
      if (!deleted) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(context, "schedule", deleted.id, "deleted");
    });
  });
