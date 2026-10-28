import { and, eq } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import * as resourceTables from "../db/schema";
import { browser, tx } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json } from "../http/responses";
import { approvalsRepository } from "../repositories/approvals";
import { executorsRepository } from "../repositories/executors";
import { projectsRepository } from "../repositories/projects";
import { runsRepository } from "../repositories/runs";
import { workspaceSettingsRepository } from "../repositories/workspace-settings";
import { digest, randomSecret } from "../shared/security";
export async function handleExecutorRoute(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (
    (resource === "projects" || resource === "agents") &&
    id &&
    sub === "executor"
  ) {
    browser(ctx, true);
    projectsRepository(ctx).find(id);
    if (method !== "POST" && method !== "DELETE")
      throw new HttpError(405, "Method not allowed.");
    const b = method === "POST" ? await body() : {};
    const locallyManaged = b.locally_managed ?? false;
    if (typeof locallyManaged !== "boolean")
      throw new HttpError(400, "locally_managed must be boolean.");
    const bootstrap = process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN;
    if (method === "POST" && locallyManaged && !bootstrap)
      throw new HttpError(400, "Local executor management is not configured.");
    return tx(ctx, () => {
      let worker = executorsRepository(ctx).list(
        eq(resourceTables.executors.projectId, id),
      )[0];
      if (worker) {
        for (const run of runsRepository(ctx)
          .list()
          .filter(
            (r) =>
              r.executorId === worker?.id &&
              ["running", "waiting_approval"].includes(r.status),
          )) {
          runsRepository(ctx).update(run.id, {
            status: "cancelled",
            cancelRequested: true,
            capabilityHash: "",
            executorId: null,
            leaseExpiresAt: null,
          });
          for (const approval of approvalsRepository(ctx).list(
            and(
              eq(resourceTables.approvals.runId, run.id),
              eq(resourceTables.approvals.status, "pending"),
            ),
          ))
            approvalsRepository(ctx).update(approval.id, {
              status: "interrupted",
            });
        }
        worker = executorsRepository(ctx).update(worker.id, {
          enabled: false,
          locallyManaged: false,
          registrationNonce: randomUUID(),
          tokenHash: digest(randomSecret()),
        });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      const nonce = randomUUID(),
        secret = randomSecret(),
        pool =
          workspaceSettingsRepository(ctx).list()[0]?.executionPool ?? "shared";
      if (worker)
        worker = executorsRepository(ctx).update(worker.id, {
          enabled: true,
          locallyManaged,
          registrationNonce: nonce,
          tokenHash: digest(secret),
          protocolVersion: 1,
          capabilities: [],
          lastSeenAt: null,
          pool,
        });
      else
        worker = executorsRepository(ctx).create({
          projectId: id,
          name: `project-${id}`,
          pool,
          tokenHash: digest(secret),
          registrationNonce: nonce,
          locallyManaged,
          enabled: true,
          protocolVersion: 1,
          capabilities: [],
          lastSeenAt: null,
        });
      const token = locallyManaged
        ? createHmac("sha256", bootstrap!)
            .update(`${worker.id}:${nonce}`)
            .digest("hex")
        : secret;
      if (locallyManaged)
        worker = executorsRepository(ctx).update(worker.id, {
          tokenHash: digest(token),
        });
      return json({ executor_id: worker.id, agent_id: id, token });
    });
  }
  return null;
}
