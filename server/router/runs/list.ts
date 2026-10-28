import { visibleRuns } from "../../runs/queries";
import { serializeRun } from "../../runs/views";
import { page } from "../../shared/pagination";
import { scopedProcedure } from "../procedures";

export const listProcedure = scopedProcedure("runs:read").query(({ ctx }) => {
  return page(visibleRuns(ctx).map((run) => serializeRun(ctx, run)));
});
