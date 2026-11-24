import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { approvals, plugins, runs, shellRules } from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import { executableName, supportsShellPolicy } from "../plugins/shell-policy";
import { snapshotAgents } from "../projects/snapshot-schema";
import { base, now } from "../shared/records";
import type { Run } from "./authority";
import { redact } from "./redaction";

const invocation = z.strictObject({
  executable: executableName,
  args: z
    .array(
      z
        .string()
        .max(4096)
        .refine((arg) => !arg.includes("\0")),
    )
    .max(64),
});
export function shellPolicyRequest(
  ctx: AppContext,
  run: Run,
  pluginId: string,
  approvalId: string | undefined,
  method: string,
  body: Record<string, unknown>,
) {
  const plugin = ctx.db
    .select()
    .from(plugins)
    .where(
      and(
        eq(plugins.id, pluginId),
        eq(plugins.projectId, run.projectId),
        eq(plugins.workspaceId, run.workspaceId),
        eq(plugins.enabled, true),
      ),
    )
    .get();
  const agent = snapshotAgents(run.snapshot).find(
    (agent) => agent.id === run.projectId,
  );
  if (
    !plugin ||
    !supportsShellPolicy(plugin) ||
    !agent?.plugins.some(
      (slot) =>
        slot.shell_policy_id === plugin.id && slot.digest === plugin.digest,
    )
  ) {
    throw new HttpError(
      403,
      "Shell is outside this run's active plugin grants.",
    );
  }
  if (!approvalId && method === "GET") {
    return json(
      ctx.db
        .select({ name: shellRules.executable })
        .from(shellRules)
        .where(
          and(
            eq(shellRules.pluginId, pluginId),
            eq(shellRules.decision, "allow"),
          ),
        )
        .orderBy(asc(shellRules.executable))
        .all()
        .map((rule) => rule.name),
    );
  }
  if (approvalId && method === "GET") {
    const row = ctx.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.id, approvalId),
          eq(approvals.workspaceId, run.workspaceId),
          eq(approvals.runId, run.id),
        ),
      )
      .get();
    if (
      row?.shell?.pluginId !== plugin.id ||
      row.shell.digest !== plugin.digest
    ) {
      throw new HttpError(404, "Shell approval not found.");
    }
    const blocked = ctx.db
      .select()
      .from(shellRules)
      .where(
        and(
          eq(shellRules.pluginId, pluginId),
          eq(shellRules.executable, row.shell.executable),
          eq(shellRules.decision, "block"),
        ),
      )
      .get();
    return json({
      id: row.id,
      status: blocked && row.status === "approved" ? "denied" : row.status,
    });
  }
  if (approvalId || method !== "POST") {
    throw new HttpError(405, "Method not allowed.");
  }
  const parsed = invocation.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, "Invalid Shell executable or arguments.");
  }
  const { executable, args } = parsed.data;
  const rule = ctx.db
    .select()
    .from(shellRules)
    .where(
      and(
        eq(shellRules.pluginId, pluginId),
        eq(shellRules.executable, executable),
      ),
    )
    .get();
  if (rule) {
    return json({ status: rule.decision === "allow" ? "approved" : "denied" });
  }
  const argv = JSON.stringify(
    redact(ctx, run.workspaceId, [executable, ...args]),
  );
  const row = ctx.db
    .insert(approvals)
    .values({
      ...base(run.workspaceId),
      runId: run.id,
      prompt: argv,
      shell: {
        pluginId,
        projectId: run.projectId,
        digest: plugin.digest,
        executable,
      },
      status: "pending",
    })
    .returning()
    .get();
  ctx.db
    .update(runs)
    .set({ status: "waiting_approval", updatedAt: now() })
    .where(eq(runs.id, run.id))
    .run();
  return json({ id: row.id, status: row.status }, 201);
}
