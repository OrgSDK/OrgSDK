import { webhooks } from "../../db/schema";
import { base } from "../../shared/records";
import { recordAudit } from "../../repositories/audit";
import { browserManagerProcedure } from "../procedures";
import { webhookCreateSchema } from "../../automations/webhook-schemas";
import { inTransaction } from "../../db/transaction";
import { actionVersion } from "../../actions/versions";
import { ServiceError } from "../../shared/errors";
import { now } from "../../shared/records";
import { digest, randomSecret } from "../../shared/security";
import { webhookView } from "../../automations/webhook-view";

export const createProcedure = browserManagerProcedure
  .input(webhookCreateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      const { action, version } = actionVersion(context, input.action);
      if (!action.enabled) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Choose an enabled action with a saved version.",
        );
      }
      const secret = randomSecret();
      const webhook = context.db
        .insert(webhooks)
        .values({
          ...base(context.workspace.id),
          name: input.name,
          actionVersionId: version.id,
          actorId: context.user.id,
          secretHash: digest(secret),
          enabled: input.enabled ?? true,
          rotatedAt: now(),
          lastReceivedAt: null,
          lastAcceptedAt: null,
          lastRejection: "",
          lastRejectedAt: null,
        })
        .returning()
        .get();
      recordAudit(context, "webhook", webhook.id, "created");
      return { webhook: webhookView(context, webhook), secret };
    });
  });
