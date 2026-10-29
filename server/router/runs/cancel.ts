import { runIdSchema } from "../../runs/schemas";
import { scopedProcedure } from "../procedures";
import { and, eq } from "drizzle-orm";
import { approvals } from "../../db/schema";
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
      const pendingApprovals = ctx.db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.workspaceId, ctx.workspace.id),
            eq(approvals.runId, id),
            eq(approvals.status, "pending"),
          ),
        )
        .all();
      for (const approval of pendingApprovals) {
        approvalsRepository(ctx).update(approval.id, { status: "interrupted" });
      }
      return updated;
    });
    return serializeRun(updated);
  });
