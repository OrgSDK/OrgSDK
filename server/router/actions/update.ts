import { updateActionSchema } from "../../actions/schemas";
import { and, eq } from "drizzle-orm";
import { actions } from "../../db/schema";
import { recordAudit } from "../../repositories/audit";
import { now } from "../../shared/records";
import { scopedProcedure } from "../procedures";
import { projectGrant, tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { actionsRepository } from "../../repositories/actions";
import {
  booleanValue,
  optionalDescription,
  text,
} from "../../shared/validation";
import { serializeAction } from "../../actions/views";

export const updateProcedure = scopedProcedure("actions:write")
  .input(updateActionSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(body.id);
      projectGrant(ctx, action.projectId);
      if (body.project && body.project !== action.projectId) {
        throw new ServiceError("BAD_REQUEST", "Action cannot move projects.");
      }
      const updatedAction = ctx.db
        .update(actions)
        .set({
          name: body.name === undefined ? action.name : text(body.name, "name"),
          description: optionalDescription(
            body.description,
            action.description,
          ),
          enabled: booleanValue(body.enabled, action.enabled),
          updatedAt: now(),
        })
        .where(
          and(
            eq(actions.workspaceId, ctx.workspace.id),
            eq(actions.id, body.id),
          ),
        )
        .returning()
        .get();
      if (!updatedAction) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(ctx, "action", updatedAction.id, "updated");
      return serializeAction(updatedAction);
    });
  });
