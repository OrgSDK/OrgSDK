import { and, eq } from "drizzle-orm";
import { actionGrant } from "../../actions/queries";
import { actions } from "../../db/schema";
import { serializeAction } from "../../actions/views";
import { page } from "../../shared/pagination";
import { scopedProcedure } from "../procedures";

export const listProcedure = scopedProcedure("catalog:read").query(
  ({ ctx }) => {
    const visibleActions = ctx.db
      .select()
      .from(actions)
      .where(and(eq(actions.workspaceId, ctx.workspace.id), actionGrant(ctx)))
      .all();
    return page(visibleActions.map(serializeAction));
  },
);
