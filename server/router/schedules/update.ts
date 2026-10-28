import { and, eq } from "drizzle-orm";
import { schedules } from "../../db/schema";
import { now } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { browserWorkspaceProcedure } from "../procedures";
import { scheduleUpdateSchema } from "../../automations/schedule-schemas";
import { inTransaction } from "../../db/transaction";
import { actionVersion } from "../../actions/versions";
import { ServiceError } from "../../shared/errors";
import { actionsRepository } from "../../repositories/actions";
import { schedulesRepository } from "../../repositories/schedules";
import { jsonValue, validateContract } from "../../shared/contracts";
import { nextCron } from "../../automations/cron";
import { scheduleView } from "../../automations/schedule-view";

export const updateProcedure = browserWorkspaceProcedure
  .input(scheduleUpdateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      const previous = schedulesRepository(context).find(input.id);
      const action = actionsRepository(context).find(
        input.action ?? previous.actionId,
      );
      if (!action.enabled) {
        throw new ServiceError("BAD_REQUEST", "Action is disabled.");
      }
      const version = actionVersion(context, action.id).version;
      const inputs = jsonValue(input.inputs ?? previous.inputs, "Inputs");
      validateContract(version.inputSchema, inputs);
      const cron = input.cron ?? previous.cron;
      const nextRunAt =
        cron !== previous.cron || (!previous.enabled && input.enabled)
          ? nextCron(cron)
          : previous.nextRunAt;
      const schedule = context.db
        .update(schedules)
        .set({
          actionId: action.id,
          cron,
          inputs,
          enabled: input.enabled ?? previous.enabled,
          nextRunAt,
          updatedAt: now(),
        })
        .where(
          and(
            eq(schedules.workspaceId, context.workspace.id),
            eq(schedules.id, input.id),
          ),
        )
        .returning()
        .get();
      if (!schedule) {
        throw new ServiceError("NOT_FOUND", "Not found.");
      }
      recordAudit(context, "schedule", schedule.id, "updated");
      return scheduleView(schedule);
    });
  });
