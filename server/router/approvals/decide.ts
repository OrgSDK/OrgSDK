import { decideApprovalSchema } from "../../runs/approvals";
import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { approvalsRepository } from "../../repositories/approvals";
import { runsRepository } from "../../repositories/runs";
import { approvalView } from "../../runs/approvals";

export const decideProcedure = browserManagerProcedure
  .input(decideApprovalSchema)
  .mutation(({ ctx, input }) => {
    return approvalView(
      tx(ctx, (ctx) => {
        const approval = approvalsRepository(ctx).find(input.id);
        if (
          approval.status !== "pending" ||
          ["succeeded", "failed", "cancelled", "interrupted"].includes(
            runsRepository(ctx).find(approval.runId).status,
          )
        ) {
          throw new ServiceError(
            "CONFLICT",
            "Approval is no longer actionable.",
          );
        }
        return approvalsRepository(ctx).update(input.id, {
          status: input.decision,
          decidedBy: ctx.user.id,
        });
      }),
    );
  });
