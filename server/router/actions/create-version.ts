import { createVersionSchema } from "../../actions/schemas";
import { scopedProcedure } from "../procedures";
import { projectGrant, tx } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import { versionForSave } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";

export const createVersionProcedure = scopedProcedure("actions:write")
  .input(createVersionSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(body.id);
      projectGrant(ctx, action.projectId);
      return serializeVersion(versionForSave(ctx, action, body));
    });
  });
