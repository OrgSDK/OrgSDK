import { protectedProcedure } from "../procedures";
import { scheduleCreateSchema } from "../../automations/schedule-schemas";
import { inTransaction } from "../../db/transaction";
import { actionVersion } from "../../actions/versions";
import { browser } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { actionsRepository } from "../../repositories/actions";
import { schedulesRepository } from "../../repositories/schedules";
import { jsonValue, validateContract } from "../../shared/contracts";
import { nextCron } from "../../automations/cron";
import { scheduleView } from "../../automations/schedule-view";

export const createProcedure = protectedProcedure
  .input(scheduleCreateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      browser(context);
      const action = actionsRepository(context).find(input.action);
      if (!action.enabled) {
        throw new ServiceError("BAD_REQUEST", "Action is disabled.");
      }
      const version = actionVersion(context, action.id).version;
      const inputs = jsonValue(input.inputs ?? {}, "Inputs");
      validateContract(version.inputSchema, inputs);
      const nextRunAt = nextCron(input.cron);
      return scheduleView(
        schedulesRepository(context).create({
          actionId: action.id,
          actorId: context.user!.id,
          cron: input.cron,
          inputs,
          enabled: input.enabled ?? true,
          nextRunAt,
        }),
      );
    });
  });
