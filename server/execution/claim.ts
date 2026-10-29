import { and, asc, eq, inArray } from "drizzle-orm";
import * as t from "../db/schema";
import { memberships } from "../db/schema/core";
import type { AppContext } from "../http/context";
import { json } from "../http/responses";
import { now } from "../shared/records";
import { digest, randomSecret } from "../shared/security";
import { type Executor } from "./authority";
export function claim(ctx: AppContext, worker: Executor): Response {
  const setting = ctx.db
    .select()
    .from(t.workspaceSettings)
    .where(eq(t.workspaceSettings.workspaceId, worker.workspaceId))
    .get();
  if (setting && (!setting.enabled || setting.executionPool !== worker.pool)) {
    return new Response(null, { status: 204 });
  }
  const active = ctx.db
    .select()
    .from(t.runs)
    .where(
      and(
        eq(t.runs.workspaceId, worker.workspaceId),
        inArray(t.runs.status, ["running", "waiting_approval"]),
      ),
    )
    .all();
  if (
    active.some((run) => run.projectId === worker.projectId) ||
    active.length >= (setting?.maxConcurrentRuns ?? 4)
  ) {
    return new Response(null, { status: 204 });
  }
  const candidates = ctx.db
    .select()
    .from(t.runs)
    .where(
      and(
        eq(t.runs.projectId, worker.projectId),
        eq(t.runs.workspaceId, worker.workspaceId),
        eq(t.runs.status, "queued"),
      ),
    )
    .orderBy(asc(t.runs.createdAt))
    .all();
  for (const run of candidates) {
    if (!worker.capabilities.includes(run.operation)) {
      continue;
    }
    const protocol =
      ["validate", "test"].includes(run.operation) ||
      run.snapshot.validation_mode === "semantic"
        ? 3
        : run.operation === "code"
          ? 2
          : 1;
    if (worker.protocolVersion < protocol) {
      continue;
    }
    const member = ctx.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, run.actorId),
          eq(memberships.workspaceId, run.workspaceId),
        ),
      )
      .get();
    const token = run.tokenId
      ? ctx.db
          .select()
          .from(t.accessTokens)
          .where(eq(t.accessTokens.id, run.tokenId))
          .get()
      : null;
    if (
      !member ||
      run.cancelRequested ||
      (run.tokenId && (!token || token.revoked))
    ) {
      ctx.db
        .update(t.runs)
        .set({
          status: "cancelled",
          cancelRequested: true,
          updatedAt: now(),
        })
        .where(eq(t.runs.id, run.id))
        .run();
      continue;
    }
    const capability = randomSecret();
    const deadline = new Date(Date.now() + 3600000).toISOString();
    ctx.db
      .update(t.runs)
      .set({
        status: "running",
        executorId: worker.id,
        capabilityHash: digest(capability),
        deadline,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        updatedAt: now(),
      })
      .where(eq(t.runs.id, run.id))
      .run();
    ctx.db
      .update(t.executors)
      .set({ lastSeenAt: now() })
      .where(eq(t.executors.id, worker.id))
      .run();
    return json({
      protocol_version: protocol,
      run_id: run.id,
      workspace_id: run.workspaceId,
      actor_id: run.actorId,
      operation: run.operation,
      capability,
      inputs: run.inputs,
      snapshot: run.snapshot,
      deadline,
      lease_seconds: 60,
    });
  }
  return new Response(null, { status: 204 });
}
