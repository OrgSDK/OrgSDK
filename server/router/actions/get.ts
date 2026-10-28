import { visibleAction } from "../../actions/queries";
import { actionIdSchema } from "../../actions/schemas";
import { serializeAction } from "../../actions/views";
import { scopedProcedure } from "../procedures";

export const getProcedure = scopedProcedure("catalog:read")
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    return serializeAction(visibleAction(ctx, input.id));
  });
