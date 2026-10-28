import { schedules } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { browserWorkspaceProcedure } from "../procedures";
import { scheduleCreateSchema } from "../../automations/schedule-schemas";
import { inTransaction } from "../../db/transaction";
import { actionVersion } from "../../actions/versions";
import { ServiceError } from "../../shared/errors";
import { actionsRepository } from "../../repositories/actions";
import { jsonValue, validateContract } from "../../shared/contracts";
import { nextCron } from "../../automations/cron";
import { scheduleView } from "../../automations/schedule-view";

export const createProcedure = browserWorkspaceProcedure
  .input(scheduleCreateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      const action = actionsRepository(context).find(input.action);
      if (!action.enabled) {
        throw new ServiceError("BAD_REQUEST", "Action is disabled.");
      }
      const version = actionVersion(context, action.id).version;
      const inputs = jsonValue(input.inputs ?? {}, "Inputs");
      validateContract(version.inputSchema, inputs);
      const nextRunAt = nextCron(input.cron);
      const schedule = context.db
        .insert(schedules)
        .values({
          ...base(context.workspace.id),
          actionId: action.id,
          actorId: context.user.id,
          cron: input.cron,
          inputs,
          enabled: input.enabled ?? true,
          nextRunAt,
        })
        .returning()
        .get();
      recordAudit(context, "schedule", schedule.id, "created");
      return scheduleView(schedule);
    });
  });
