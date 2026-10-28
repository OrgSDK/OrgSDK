import { visibleVersions } from "../../actions/queries";
import { actionIdSchema } from "../../actions/schemas";
import { serializeVersion } from "../../actions/views";
import { scope } from "../../domain/permissions";
import { actionsRepository } from "../../repositories/actions";
import { protectedProcedure } from "../procedures";

export const versionsProcedure = protectedProcedure
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    scope(ctx, "catalog:read");
    const action = actionsRepository(ctx).find(input.id);
    return visibleVersions(ctx, action).map(serializeVersion);
  });
