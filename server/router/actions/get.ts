import { visibleAction } from "../../actions/queries";
import { actionIdSchema } from "../../actions/schemas";
import { serializeAction } from "../../actions/views";
import { scope } from "../../domain/permissions";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    scope(ctx, "catalog:read");
    return serializeAction(visibleAction(ctx, input.id));
  });
