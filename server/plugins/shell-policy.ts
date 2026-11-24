import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { now } from "../shared/records";
import { resumeAfterApproval } from "../runs/resume-after-approval";
import { z } from "zod";
import type { ServiceContext } from "../application";
import { approvals, type plugins, runs, shellRules } from "../db/schema";
import { recordAudit } from "../repositories/audit";
import { object } from "../shared/contracts";

export const executableName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/);
export const ruleDecision = z.enum(["allow", "block", "ask"]);
export function supportsShellPolicy(plugin: typeof plugins.$inferSelect) {
  const tools = plugin.releaseMetadata.tools;
  return (
    plugin.slug === "shell" &&
    plugin.distribution === "external" &&
    Array.isArray(tools) &&
    tools.some(
      (tool) =>
        object(tool) &&
        tool.name === "run" &&
        object(tool.metadata) &&
        tool.metadata.approval === "shell-executable",
    )
  );
}

export function writeShellRule(
  ctx: ServiceContext,
  plugin: typeof plugins.$inferSelect,
  executable: string,
  decision: z.infer<typeof ruleDecision>,
) {
  const pluginId = plugin.id;
  if (decision === "ask") {
    ctx.db
      .delete(shellRules)
      .where(
        and(
          eq(shellRules.pluginId, pluginId),
          eq(shellRules.executable, executable),
        ),
      )
      .run();
  } else {
    ctx.db
      .insert(shellRules)
      .values({ pluginId, executable, decision })
      .onConflictDoUpdate({
        target: [shellRules.pluginId, shellRules.executable],
        set: { decision },
      })
      .run();
  }
  if (decision !== "ask") {
    const currentTime = now();
    const liveRunIds = ctx.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.projectId, plugin.projectId),
          eq(runs.workspaceId, plugin.workspaceId),
          eq(runs.cancelRequested, false),
          eq(runs.status, "waiting_approval"),
          gt(runs.leaseExpiresAt, currentTime),
          gt(runs.deadline, currentTime),
        ),
      );
    const changed = ctx.db
      .update(approvals)
      .set({
        status: decision === "allow" ? "approved" : "denied",
        decidedBy: ctx.user?.id,
        updatedAt: currentTime,
      })
      .where(
        and(
          eq(approvals.workspaceId, plugin.workspaceId),
          eq(approvals.status, "pending"),
          inArray(approvals.runId, liveRunIds),
          sql`json_extract(${approvals.shell}, '$.pluginId') = ${plugin.id} and json_extract(${approvals.shell}, '$.digest') = ${plugin.digest} and json_extract(${approvals.shell}, '$.executable') = ${executable}`,
        ),
      )
      .returning({ id: approvals.id, runId: approvals.runId })
      .all();
    for (const row of changed) {
      recordAudit(ctx, "approval", row.id, "updated");
      resumeAfterApproval(ctx, row.runId);
    }
  }
  recordAudit(ctx, "shell_rule", pluginId + "/" + executable, decision);
}
