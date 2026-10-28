import { randomUUID } from "node:crypto";
import type { ServiceContext } from "../application";
import { requireWorkspace } from "../shared/authorization";
import { approvalsRepository } from "../repositories/approvals";
import { executorsRepository } from "../repositories/executors";
import { runsRepository } from "../repositories/runs";
import { digest, randomSecret } from "../shared/security";
import { projectQueries } from "./queries";
export function revokeExecutor(ctx: ServiceContext, id: string) {
  const queries = projectQueries(ctx.db, requireWorkspace(ctx).id);
  const worker = queries.executorForProject(id);
  if (worker) {
    for (const run of queries.activeRunsForExecutor(worker.id)) {
      runsRepository(ctx).update(run.id, {
        status: "cancelled",
        cancelRequested: true,
        capabilityHash: "",
        executorId: null,
        leaseExpiresAt: null,
      });
      for (const approval of queries.pendingApprovalsForRun(run.id)) {
        approvalsRepository(ctx).update(approval.id, {
          status: "interrupted",
        });
      }
    }
    executorsRepository(ctx).update(worker.id, {
      enabled: false,
      locallyManaged: false,
      registrationNonce: randomUUID(),
      tokenHash: digest(randomSecret()),
    });
  }
}
