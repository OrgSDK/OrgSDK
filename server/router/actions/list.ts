import { visibleActions } from "../../actions/queries";
import { serializeAction } from "../../actions/views";
import { scope } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  scope(ctx, "catalog:read");
  return page(visibleActions(ctx).map(serializeAction));
});
