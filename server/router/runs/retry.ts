import { retryRunSchema } from "../../runs/schemas";
import { protectedProcedure } from "../procedures";
import { findIdempotentRun } from "../../runs/queries";
import {
  authorizeRunRead,
  authorizeVersion,
  projectGrant,
  scope,
  tx,
} from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { actionVersionsRepository } from "../../repositories/action-versions";
import { actionsRepository } from "../../repositories/actions";
import { runsRepository } from "../../repositories/runs";
import { text } from "../../shared/validation";
import { serializeRun } from "../../runs/views";

export const retryProcedure = protectedProcedure
  .input(retryRunSchema)
  .mutation(({ ctx, input }) =>
    tx(ctx, (ctx) => {
      const run = runsRepository(ctx).find(input.id);
      authorizeRunRead(ctx, run, null);
      if (!["failed", "cancelled", "interrupted"].includes(run.status)) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Only failed, cancelled or interrupted runs can be retried.",
        );
      }
      const key = text(input.idempotency_key, "idempotency key", 200);
      const requiredScope = {
        code: "code:execute",
        validate: "actions:write",
        test: "actions:test",
        action: "actions:run",
      };
      const required = Object.entries(requiredScope).find(
        ([operation]) => operation === run.operation,
      )?.[1];
      if (!required) {
        throw new ServiceError("BAD_REQUEST", "Invalid run operation.");
      }
      scope(ctx, required);
      if (run.actionVersionId) {
        const version = actionVersionsRepository(ctx).find(run.actionVersionId);
        authorizeVersion(
          ctx,
          actionsRepository(ctx).find(version.actionId),
          version,
          true,
        );
      } else {
        projectGrant(ctx, run.projectId);
      }
      const namespace = ctx.token?.id ?? "";
      const existing = findIdempotentRun(ctx, namespace, key);
      if (existing) {
        if (existing.retryOf !== run.id) {
          throw new ServiceError(
            "BAD_REQUEST",
            "Idempotency key already used for a different request.",
          );
        }
        return serializeRun(existing);
      }
      const retry = runsRepository(ctx).create({
        projectId: run.projectId,
        actorId: ctx.user.id,
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
        idempotencyNamespace: namespace,
        retryOf: run.id,
        cancelRequested: false,
        executorId: null,
        leaseExpiresAt: null,
        deadline: null,
        capabilityHash: "",
      });
      return serializeRun(retry);
    }),
  );
