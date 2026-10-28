import { protectedProcedure } from "../procedures";
import { webhookUpdateSchema } from "../../automations/webhook-schemas";
import { inTransaction } from "../../db/transaction";
import { browser } from "../../domain/permissions";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const updateProcedure = protectedProcedure
  .input(webhookUpdateSchema)
  .mutation(({ ctx: context, input }) => {
    return inTransaction(context, (context) => {
      browser(context, true);
      const previous = webhooksRepository(context).find(input.id);
      const webhook = webhooksRepository(context).update(input.id, {
        name: input.name ?? previous.name,
        enabled: input.enabled ?? previous.enabled,
      });
      return webhookView(context, webhook);
    });
  });
