import { and, eq } from "drizzle-orm";
import { resolveActionForSave, versionForSave } from "../actions/versions";
import { serializeVersion } from "../actions/views";
import * as resourceTables from "../db/schema";
import {
  authoringGrant,
  authorizeRunRead,
  authorizeVersion,
  isClient,
  projectGrant,
  scope,
  tx,
} from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { approvalsRepository } from "../repositories/approvals";
import { runEventsRepository } from "../repositories/run-events";
import { runsRepository } from "../repositories/runs";
import { text } from "../shared/validation";
import { createRun } from "./create";
import { streamRun } from "./stream";
import { serializeRun } from "./views";
export async function handleRuns(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "runs") {
    if (method === "POST" && !id)
      return json(serializeRun(ctx, createRun(ctx, await body())), 201);
    if (method === "GET" && !id) {
      scope(ctx, "runs:read");
      return json(
        page(
          runsRepository(ctx)
            .list()
            .filter(
              (r) =>
                !isClient(ctx) ||
                (r.tokenId === ctx.token!.id &&
                  (ctx.token!.projects.includes(r.projectId) ||
                    (r.actionVersionId !== null &&
                      ctx.token!.actionVersions.includes(r.actionVersionId)))),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((r) => serializeRun(ctx, r)),
        ),
      );
    }
    if (id) {
      const run = runsRepository(ctx).find(id);
      authorizeRunRead(
        ctx,
        run,
        sub === "retry" && method === "POST"
          ? null
          : sub === "cancel"
            ? "runs:cancel"
            : "runs:read",
      );
      if (method === "GET" && !sub) return json(serializeRun(ctx, run));
      if (method === "GET" && sub === "stream") return streamRun(ctx, run);
      if (method === "GET" && sub === "events")
        return json(
          runEventsRepository(ctx)
            .list(eq(resourceTables.runEvents.runId, id))
            .sort((a, b) => a.sequence - b.sequence)
            .map((e) => ({
              sequence: e.sequence,
              kind: e.kind,
              data: e.data,
              created_at: e.createdAt,
            })),
        );
      if (method === "POST" && sub === "retry") {
        if (!["failed", "cancelled", "interrupted"].includes(run.status))
          throw new HttpError(
            400,
            "Only failed, cancelled or interrupted runs can be retried.",
          );
        const b = await body();
        const key = text(b.idempotency_key, "idempotency key", 200);
        scope(
          ctx,
          run.operation === "code"
            ? "code:execute"
            : run.operation === "validate"
              ? "actions:write"
              : run.operation === "test"
                ? "actions:test"
                : "actions:run",
        );
        if (run.actionVersionId) {
          const v = actionVersionsRepository(ctx).find(run.actionVersionId);
          authorizeVersion(
            ctx,
            actionsRepository(ctx).find(v.actionId),
            v,
            true,
          );
        } else projectGrant(ctx, run.projectId);
        const retry = tx(ctx, () => {
          const existing = runsRepository(ctx).list(
            and(
              eq(
                resourceTables.runs.idempotencyNamespace,
                isClient(ctx) ? ctx.token!.id : "",
              ),
              eq(resourceTables.runs.idempotencyKey, key),
            ),
          )[0];
          if (existing) {
            if (existing.retryOf !== run.id)
              throw new HttpError(
                400,
                "Idempotency key already used for a different request.",
              );
            return existing;
          }
          const copy = runsRepository(ctx).create({
            projectId: run.projectId,
            actorId: ctx.user!.id,
            tokenId: ctx.token?.id ?? null,
            actionVersionId: run.actionVersionId,
            operation: run.operation,
            origin: "retry",
            originReference: run.id,
            inputs: run.inputs,
            snapshot: run.snapshot,
            status: "queued",
            output: {},
            error: "",
            idempotencyKey: key,
            idempotencyNamespace: isClient(ctx) ? ctx.token!.id : "",
            retryOf: run.id,
            cancelRequested: false,
            executorId: null,
            leaseExpiresAt: null,
            deadline: null,
            capabilityHash: "",
          });
          return copy;
        });
        return json(serializeRun(ctx, retry), 201);
      }
      if (method === "POST" && sub === "promote") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, run.projectId);
        if (run.operation !== "code")
          throw new HttpError(400, "Only one-off code runs can be promoted.");
        const b = await body();
        return json(
          tx(ctx, () => {
            const action = resolveActionForSave(
              ctx,
              run.projectId,
              b.name,
              b.action,
            );
            return {
              action: action.id,
              version: serializeVersion(
                versionForSave(
                  ctx,
                  action,
                  {
                    ...b,
                    source: run.snapshot.source,
                    sdk_contract: {
                      sdk_revision: run.snapshot.sdk_revision,
                      configuration_revision:
                        run.snapshot.configuration_revision,
                      sdk: run.snapshot.sdk,
                    },
                  },
                  run.id,
                ),
              ),
            };
          }),
          201,
        );
      }
      if (method === "POST" && sub === "cancel")
        return json(
          serializeRun(
            ctx,
            tx(ctx, () => {
              if (
                ["queued", "running", "waiting_approval"].includes(run.status)
              ) {
                const state =
                  run.status === "queued" ? "cancelled" : run.status;
                const updated = runsRepository(ctx).update(id, {
                  status: state,
                  cancelRequested: true,
                });
                for (const approval of approvalsRepository(ctx).list(
                  and(
                    eq(resourceTables.approvals.runId, id),
                    eq(resourceTables.approvals.status, "pending"),
                  ),
                ))
                  approvalsRepository(ctx).update(approval.id, {
                    status: "interrupted",
                  });
                return updated;
              }
              return run;
            }),
          ),
        );
    }
  }
  return null;
}
