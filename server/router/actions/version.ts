import { actionVersionSchema } from "../../actions/schemas";
import { actionVersion } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";
import { authorizeVersion, scope } from "../../domain/permissions";
import { protectedProcedure } from "../procedures";

export const versionProcedure = protectedProcedure
  .input(actionVersionSchema)
  .query(({ ctx, input }) => {
    scope(ctx, "catalog:read");
    const { action, version } = actionVersion(ctx, input.id, input.version);
    authorizeVersion(ctx, action, version, input.version !== undefined);
    return serializeVersion(version);
  });
