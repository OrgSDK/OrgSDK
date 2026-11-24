import { resumeAfterApproval } from "../../runs/resume-after-approval";
import { browserManagerProcedure } from "../procedures";
import { tx } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { now } from "../../shared/records";
import { approvalsRepository } from "../../repositories/approvals";
import { runsRepository } from "../../repositories/runs";
import { pluginsRepository } from "../../repositories/plugins";
import { assertCurrentPluginManager } from "../../plugins/validation";
import {
  supportsShellPolicy,
  writeShellRule,
} from "../../plugins/shell-policy";
import { approvalView, decideApprovalSchema } from "../../runs/approvals";

export const decideProcedure = browserManagerProcedure
  .input(decideApprovalSchema)
  .mutation(({ ctx, input }) =>
    tx(ctx, (ctx) => {
      assertCurrentPluginManager(ctx);
      const approval = approvalsRepository(ctx).find(input.id);
      const run = runsRepository(ctx).find(approval.runId);
      const currentTime = now();
      if (
        approval.status !== "pending" ||
        run.cancelRequested ||
        !["running", "waiting_approval"].includes(run.status) ||
        (run.deadline && run.deadline <= currentTime) ||
        (run.leaseExpiresAt && run.leaseExpiresAt <= currentTime)
      ) {
        throw new ServiceError("CONFLICT", "Approval is no longer actionable.");
      }
      const persistent =
        input.decision === "always_allow" || input.decision === "block";
      if (persistent && !approval.shell) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Persistent decisions require a Shell executable request.",
        );
      }
      if (approval.shell) {
        const plugin = pluginsRepository(ctx).find(approval.shell.pluginId);
        if (
          !plugin.enabled ||
          !supportsShellPolicy(plugin) ||
          plugin.projectId !== run.projectId ||
          plugin.digest !== approval.shell.digest
        ) {
          throw new ServiceError(
            "CONFLICT",
            "The Shell installation changed since this request.",
          );
        }
        if (persistent) {
          writeShellRule(
            ctx,
            plugin,
            approval.shell.executable,
            input.decision === "block" ? "block" : "allow",
          );
          return approvalView(approvalsRepository(ctx).find(input.id));
        }
      }
      const status =
        input.decision === "denied" || input.decision === "block"
          ? "denied"
          : "approved";
      const updated = approvalsRepository(ctx).update(input.id, {
        status,
        decidedBy: ctx.user.id,
      });
      resumeAfterApproval(ctx, run.id);
      return approvalView(updated);
    }),
  );
