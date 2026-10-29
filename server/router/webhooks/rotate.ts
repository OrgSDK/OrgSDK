import { browserManagerProcedure } from "../procedures";
import { z } from "zod";
import { inTransaction } from "../../db/transaction";
import { webhooksRepository } from "../../repositories/webhooks";
import { now } from "../../shared/records";
import { digest, randomSecret } from "../../shared/security";
import { webhookView } from "../../automations/webhook-view";

export const rotateProcedure = browserManagerProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .mutation(({ ctx: context, input }) => {
    const id = input.id;

    return inTransaction(context, (context) => {
      const secret = randomSecret();
      const webhook = webhooksRepository(context).update(id, {
        secretHash: digest(secret),
        rotatedAt: now(),
      });
      return { webhook: webhookView(context, webhook), secret };
    });
  });
