import { actionVersionSchema } from "../../actions/schemas";
import { actionVersion } from "../../actions/versions";
import { serializeVersion } from "../../actions/views";
import { authorizeVersion } from "../../domain/permissions";
import { scopedProcedure } from "../procedures";

export const versionProcedure = scopedProcedure("catalog:read")
  .input(actionVersionSchema)
  .query(({ ctx, input }) => {
    const { action, version } = actionVersion(ctx, input.id, input.version);
    authorizeVersion(ctx, action, version, input.version !== undefined);
    return serializeVersion(version);
  });
