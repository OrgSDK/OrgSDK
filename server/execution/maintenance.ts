import { z } from "zod";
import { inTransaction } from "../db/transaction";
import { CronExpressionParser } from "cron-parser";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDependencies } from "../application";
import * as t from "../db/schema";
import { ServiceError } from "../shared/errors";
import { createRun } from "../runs/create";
import { now } from "../shared/records";
import { actorContext } from "./authority";
export function maintenance(store: AppDependencies) {
  const currentTime = now();
  inTransaction(store, (store) => {
    const active = store.db
      .select()
      .from(t.runs)
      .where(inArray(t.runs.status, ["running", "waiting_approval"]))
      .all();
    for (const run of active) {
      if (
        (run.leaseExpiresAt && run.leaseExpiresAt <= currentTime) ||
        (run.deadline && run.deadline <= currentTime)
      ) {
        store.db
          .update(t.runs)
          .set({
            status: run.cancelRequested ? "cancelled" : "interrupted",
            error:
              "Execution stopped responding. Review side effects before retrying.",
            capabilityHash: "",
            updatedAt: currentTime,
          })
          .where(eq(t.runs.id, run.id))
          .run();
        store.db
          .update(t.approvals)
          .set({ status: "interrupted" })
          .where(
            and(
              eq(t.approvals.runId, run.id),
              eq(t.approvals.status, "pending"),
            ),
          )
          .run();
      }
    }
    for (const schedule of store.db
      .select()
      .from(t.schedules)
      .where(eq(t.schedules.enabled, true))
      .all()) {
      if (schedule.nextRunAt > currentTime) {
        continue;
      }
      const action = store.db
        .select()
        .from(t.actions)
        .where(eq(t.actions.id, schedule.actionId))
        .get();
      if (!action) {
        store.db
          .update(t.schedules)
          .set({ enabled: false })
          .where(eq(t.schedules.id, schedule.id))
          .run();
        continue;
      }
      const nextRunAt = CronExpressionParser.parse(schedule.cron, {
        currentDate: currentTime,
        tz: "UTC",
      })
        .next()
        .toISOString();
      if (!nextRunAt) {
        throw new Error("Schedule has no next occurrence.");
      }
      try {
        const ctx = actorContext(
          {
            userId: null,
            operationType: "mutation",
            origin: "http://localhost",
            hostname: "localhost",
            db: store.db,
            secrets: store.secrets,
            user: null,
            workspace: null,
            role: null,
            token: null,
            sessionId: null,
          },
          { workspaceId: schedule.workspaceId, actorId: schedule.actorId },
        );
        const run = createRun(ctx, {
          project: action.projectId,
          operation: "action",
          action: action.id,
          inputs: z.record(z.string(), z.json()).parse(schedule.inputs),
          idempotency_key: `schedule:${schedule.id}:${schedule.nextRunAt}`,
        });
        store.db
          .update(t.runs)
          .set({ origin: "schedule", originReference: schedule.id })
          .where(eq(t.runs.id, run.id))
          .run();
      } catch (error) {
        if (!(error instanceof ServiceError)) {
          throw error;
        }
      }
      store.db
        .update(t.schedules)
        .set({ nextRunAt, updatedAt: currentTime })
        .where(eq(t.schedules.id, schedule.id))
        .run();
    }
  });
}
