import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { webhooksRepository } from "../../repositories/webhooks";
import { webhookView } from "../../automations/webhook-view";

export const listProcedure = browserWorkspaceProcedure.query(
  ({ ctx: context }) => {
    return page(
      webhooksRepository(context)
        .list()
        .map((webhook) => webhookView(context, webhook)),
    );
  },
);
