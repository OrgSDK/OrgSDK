import { browserManagerProcedure } from "../procedures";
import { webhookUpdateSchema } from "../../automations/webhook-schemas";
import { inTransaction } from "../../db/transaction";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const updateProcedure = browserManagerProcedure
  .input(webhookUpdateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      const previous = webhooksRepository(context).find(input.id);
      const webhook = webhooksRepository(context).update(input.id, {
        name: input.name ?? previous.name,
        enabled: input.enabled ?? previous.enabled,
      });
      return webhookView(context, webhook);
    });
  });
