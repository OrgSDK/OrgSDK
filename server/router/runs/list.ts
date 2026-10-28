import { scope } from "../../domain/permissions";
import { visibleRuns } from "../../runs/queries";
import { serializeRun } from "../../runs/views";
import { page } from "../../shared/pagination";
import { protectedProcedure } from "../procedures";

export const listProcedure = protectedProcedure.query(({ ctx }) => {
  scope(ctx, "runs:read");
  return page(visibleRuns(ctx).map((run) => serializeRun(ctx, run)));
});
