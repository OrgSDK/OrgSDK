import { and, eq, notExists } from "drizzle-orm";
import type { ServiceContext } from "../application";
import { approvals, runs } from "../db/schema";
import { now } from "../shared/records";
export function resumeAfterApproval(ctx: ServiceContext, runId: string) {
  const pending = ctx.db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));
  ctx.db
    .update(runs)
    .set({ status: "running", updatedAt: now() })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "waiting_approval"),
        eq(runs.cancelRequested, false),
        notExists(pending),
      ),
    )
    .run();
}
