import { saveActionSchema } from "../../actions/schemas";
import { protectedProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { resolveActionForSave, versionForSave } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";
import { authoringProject } from "../../actions/authoring";

export const saveActionProcedure = protectedProcedure
  .input(saveActionSchema)
  .mutation(({ ctx, input: body }) => {
    return tx(ctx, (ctx) => {
      const projectId = authoringProject(ctx, body);
      const action = resolveActionForSave(
        ctx,
        projectId,
        body.name,
        body.action,
      );
      return {
        action: action.id,
        version: serializeVersion(versionForSave(ctx, action, body)),
      };
    });
  });
