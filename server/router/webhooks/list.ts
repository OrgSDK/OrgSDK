import { protectedProcedure } from "../procedures";
import { browser } from "../../domain/permissions";
import { page } from "../../shared/pagination";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const listProcedure = protectedProcedure.query(({ ctx: context }) => {
  browser(context);
  return page(
    webhooksRepository(context)
      .list()
      .map((webhook) => webhookView(context, webhook)),
  );
});
