import { updateActionSchema } from "../../actions/schemas";
import { scopedProcedure } from "../procedures";
import { authoringGrant, tx } from "../../domain/permissions";
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
      authoringGrant(ctx, action.projectId);
      if (body.project && body.project !== action.projectId) {
        throw new ServiceError("BAD_REQUEST", "Action cannot move projects.");
      }
      return serializeAction(
        actionsRepository(ctx).update(body.id, {
          name: body.name === undefined ? action.name : text(body.name, "name"),
          description: optionalDescription(
            body.description,
            action.description,
          ),
          enabled: booleanValue(body.enabled, action.enabled),
        }),
      );
    });
  });
