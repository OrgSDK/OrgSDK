import { protectedProcedure } from "../procedures";
import { z } from "zod";
import { browser } from "../../domain/permissions";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const getProcedure = protectedProcedure
  .input(z.object({ id: z.uuid() }).strict())
  .query(({ ctx: context, input }) => {
    const id = input.id;

    browser(context);
    return webhookView(context, webhooksRepository(context).find(id));
  });
