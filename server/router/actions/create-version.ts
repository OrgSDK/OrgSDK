import { createVersionSchema } from "../../actions/schemas";
import { protectedProcedure } from "../procedures";
import { authoringGrant, scope, tx } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import { versionForSave } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";

export const createVersionProcedure = protectedProcedure
  .input(createVersionSchema)
  .mutation(({ ctx, input: body }) => {
    scope(ctx, "actions:write");
    return tx(ctx, (ctx) => {
      const action = actionsRepository(ctx).find(body.id);
      authoringGrant(ctx, action.projectId);
      return serializeVersion(versionForSave(ctx, action, body));
    });
  });
