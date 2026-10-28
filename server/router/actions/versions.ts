import { visibleVersions } from "../../actions/queries";
import { actionIdSchema } from "../../actions/schemas";
import { serializeVersion } from "../../actions/views";
import { actionsRepository } from "../../repositories/actions";
import { scopedProcedure } from "../procedures";

export const versionsProcedure = scopedProcedure("catalog:read")
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    const action = actionsRepository(ctx).find(input.id);
    return visibleVersions(ctx, action).map(serializeVersion);
  });
