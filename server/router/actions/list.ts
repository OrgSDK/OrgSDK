import { visibleActions } from "../../actions/queries";
import { serializeAction } from "../../actions/views";
import { page } from "../../shared/pagination";
import { scopedProcedure } from "../procedures";

export const listProcedure = scopedProcedure("catalog:read").query(
  ({ ctx }) => {
    return page(visibleActions(ctx).map(serializeAction));
  },
);
