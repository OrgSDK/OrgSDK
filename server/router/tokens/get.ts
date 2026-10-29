import { and, eq } from "drizzle-orm";
import { accessTokens } from "../../db/schema";
import { ServiceError } from "../../shared/errors";
import { tokenView } from "../../tokens/views";
import { z } from "zod";
import { browserManagerProcedure } from "../procedures";

export const getProcedure = browserManagerProcedure
  .input(z.strictObject({ id: z.uuid() }))
  .query(({ ctx, input }) => {
    const token = ctx.db
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.workspaceId, ctx.workspace.id),
          eq(accessTokens.id, input.id),
        ),
      )
      .get();
    if (!token) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return tokenView(token);
  });
