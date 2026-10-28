import { browserWorkspaceProcedure } from "../procedures";
import { z } from "zod";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const getProcedure = browserWorkspaceProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .query(({ ctx: context, input }) => {
    const id = input.id;
    return webhookView(context, webhooksRepository(context).find(id));
  });
