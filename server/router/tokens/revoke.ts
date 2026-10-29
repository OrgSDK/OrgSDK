import { and, eq } from "drizzle-orm";
import { accessTokens } from "../../db/schema";
import { now } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { ServiceError } from "../../shared/errors";
import { inTransaction } from "../../db/transaction";
import { z } from "zod";
import { browserManagerProcedure } from "../procedures";

export const revokeProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .mutation(({ ctx, input }) => {
    return inTransaction(ctx, (ctx) => {
      const token = ctx.db
        .update(accessTokens)
        .set({ revoked: true, updatedAt: now() })
        .where(
          and(
            eq(accessTokens.workspaceId, ctx.workspace.id),
            eq(accessTokens.id, input.id),
          ),
        )
        .returning()
        .get();
      if (!token) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(ctx, "token", token.id, "updated");
    });
  });
