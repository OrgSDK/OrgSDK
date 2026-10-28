import { runIdSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";
import { pendingRunApprovals } from "../../runs/queries";
import { authorizeRunRead, tx } from "../../domain/permissions";
import { approvalsRepository } from "../../repositories/approvals";
import { runsRepository } from "../../repositories/runs";
import { serializeRun } from "../../runs/views";

export const cancelProcedure = scopedProcedure("runs:cancel")
  .input(runIdSchema)
  .mutation(({ ctx, input }) => {
    const id = input.id;

    const updated = tx(ctx, (ctx) => {
      const run = runsRepository(ctx).find(id);
      authorizeRunRead(ctx, run, null);
      if (!["queued", "running", "waiting_approval"].includes(run.status)) {
        return run;
      }
      const updated = runsRepository(ctx).update(id, {
        status: run.status === "queued" ? "cancelled" : run.status,
        cancelRequested: true,
      });
      for (const approval of pendingRunApprovals(ctx, id)) {
        approvalsRepository(ctx).update(approval.id, { status: "interrupted" });
      }
      return updated;
    });
    return serializeRun(ctx, updated);
  });
