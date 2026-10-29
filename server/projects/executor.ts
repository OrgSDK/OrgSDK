import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { ServiceContext } from "../application";
import { approvals, executors, runs } from "../db/schema";
import { requireWorkspace } from "../shared/authorization";
import { approvalsRepository } from "../repositories/approvals";
import { executorsRepository } from "../repositories/executors";
import { runsRepository } from "../repositories/runs";
import { digest, randomSecret } from "../shared/security";
export function revokeExecutor(ctx: ServiceContext, id: string) {
  const workspaceId = requireWorkspace(ctx).id;
  const worker = ctx.db
    .select()
    .from(executors)
    .where(
      and(eq(executors.workspaceId, workspaceId), eq(executors.projectId, id)),
    )
    .get();
  if (!worker) {
    return;
  }
  const activeRuns = ctx.db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runs.executorId, worker.id),
        inArray(runs.status, ["running", "waiting_approval"]),
      ),
    )
    .all();
  for (const run of activeRuns) {
    runsRepository(ctx).update(run.id, {
      status: "cancelled",
      cancelRequested: true,
      capabilityHash: "",
      executorId: null,
      leaseExpiresAt: null,
    });
    const pendingApprovals = ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.workspaceId, workspaceId),
          eq(approvals.runId, run.id),
          eq(approvals.status, "pending"),
        ),
      )
      .all();
    for (const approval of pendingApprovals) {
      approvalsRepository(ctx).update(approval.id, {
        status: "interrupted",
      });
    }
  }
  return executorsRepository(ctx).update(worker.id, {
    enabled: false,
    locallyManaged: false,
    registrationNonce: randomUUID(),
    tokenHash: digest(randomSecret()),
  });
}
