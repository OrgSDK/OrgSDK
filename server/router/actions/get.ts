import { and, eq } from "drizzle-orm";
import { actionGrant } from "../../actions/queries";
import { actions } from "../../db/schema";
import { ServiceError } from "../../shared/errors";
import { actionIdSchema } from "../../actions/schemas";
import { serializeAction } from "../../actions/views";
import { scopedProcedure } from "../procedures";

export const getProcedure = scopedProcedure("catalog:read")
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    const action = ctx.db
      .select()
      .from(actions)
      .where(
        and(
          eq(actions.workspaceId, ctx.workspace.id),
          eq(actions.id, input.id),
          actionGrant(ctx),
        ),
      )
      .get();
    if (!action) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return serializeAction(action);
  });
