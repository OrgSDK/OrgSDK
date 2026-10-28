import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import * as t from "../db/schema";
import { memberships, workspaces } from "../db/schema/core";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { identityRepository } from "../repositories/identity";
import { now } from "../shared/records";
import { digest } from "../shared/security";
export type Run = typeof t.runs.$inferSelect;

export type Executor = typeof t.executors.$inferSelect;

export const terminal = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

export const equalSecret = (left: string, right: string) =>
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

export function bearer(ctx: AppContext) {
  const header = ctx.request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 1024)
    throw new HttpError(401, "Execution credential required.");
  return header.slice(7);
}

export function executor(ctx: AppContext): Executor {
  const row = ctx.store.db
    .select()
    .from(t.executors)
    .where(
      and(
        eq(t.executors.tokenHash, digest(bearer(ctx))),
        eq(t.executors.enabled, true),
      ),
    )
    .get();
  const project =
    row &&
    ctx.store.db
      .select()
      .from(t.projects)
      .where(
        and(
          eq(t.projects.id, row.projectId),
          eq(t.projects.workspaceId, row.workspaceId),
        ),
      )
      .get();
  if (!row || !project?.enabled)
    throw new HttpError(401, "Invalid executor credential.");
  return row;
}

export function runCapability(ctx: AppContext, expectedId?: string): Run {
  const run = ctx.store.db
    .select()
    .from(t.runs)
    .where(eq(t.runs.capabilityHash, digest(bearer(ctx))))
    .get();
  const currentTime = now();
  if (
    !run ||
    (expectedId && run.id !== expectedId) ||
    !run.deadline ||
    run.deadline <= currentTime ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= currentTime
  )
    throw new HttpError(401, "Invalid or expired run capability.");
  const worker =
    run.executorId &&
    ctx.store.db
      .select()
      .from(t.executors)
      .where(eq(t.executors.id, run.executorId))
      .get();
  const project = ctx.store.db
    .select()
    .from(t.projects)
    .where(eq(t.projects.id, run.projectId))
    .get();
  const member = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, run.workspaceId),
        eq(memberships.userId, run.actorId),
      ),
    )
    .get();
  if (
    !worker ||
    !worker.enabled ||
    worker.projectId !== run.projectId ||
    !project?.enabled ||
    !member
  )
    throw new HttpError(401, "Run authority was revoked.");
  const isolated = run.operation === "validate" || run.operation === "test";
  const path = new URL(ctx.request.url).pathname;
  if (
    isolated &&
    (ctx.request.method !== "POST" ||
      !["heartbeat", "events", "complete"].some(
        (action) => path === `/internal/execution/v1/runs/${run.id}/${action}/`,
      ))
  )
    throw new HttpError(403, "Isolated jobs cannot use live capabilities.");
  return run;
}

export function live(run: Run) {
  if (terminal.has(run.status) || run.cancelRequested)
    throw new HttpError(403, "Run is no longer active.");
}

export function actorContext(
  ctx: AppContext,
  run: Pick<Run, "workspaceId" | "actorId">,
): AppContext {
  const user = identityRepository(ctx.store).user(run.actorId) ?? null;
  const workspace =
    ctx.store.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, run.workspaceId))
      .get() ?? null;
  const membership = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, run.workspaceId),
        eq(memberships.userId, run.actorId),
      ),
    )
    .get();
  if (!user || !workspace || !membership)
    throw new HttpError(403, "Membership revoked.");
  return { ...ctx, user, workspace, role: membership.role, token: null };
}
