import { createVersionSchema } from "../../actions/schemas";
import { scopedProcedure } from "../procedures";
import { authoringGrant, tx } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import { versionForSave } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";

export const createVersionProcedure = scopedProcedure("actions:write")
  .input(createVersionSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(body.id);
      authoringGrant(ctx, action.projectId);
      return serializeVersion(versionForSave(ctx, action, body));
    });
  });
