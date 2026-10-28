import { protectedProcedure } from "../procedures";
import { webhookCreateSchema } from "../../automations/webhook-schemas";
import { inTransaction } from "../../db/transaction";
import { actionVersion } from "../../actions/versions";
import { browser } from "../../domain/permissions";
import { ServiceError } from "../../shared/errors";
import { webhooksRepository } from "../../repositories/webhooks";
import { now } from "../../shared/records";
import { digest, randomSecret } from "../../shared/security";
import { webhookView } from "../../automations/webhook-view";

export const createProcedure = protectedProcedure
  .input(webhookCreateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      browser(context, true);
      const { action, version } = actionVersion(context, input.action);
      if (!action.enabled) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Choose an enabled action with a saved version.",
        );
      }
      const secret = randomSecret();
      const webhook = webhooksRepository(context).create({
        name: input.name,
        actionVersionId: version.id,
        actorId: context.user!.id,
        secretHash: digest(secret),
        enabled: input.enabled ?? true,
        rotatedAt: now(),
        lastReceivedAt: null,
        lastAcceptedAt: null,
        lastRejection: "",
        lastRejectedAt: null,
      });
      return { webhook: webhookView(context, webhook), secret };
    });
  });
