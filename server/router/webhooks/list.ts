import { eq } from "drizzle-orm";
import { webhooks } from "../../db/schema";
import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { webhookView } from "../../automations/webhook-view";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const records = ctx.db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, ctx.workspace.id))
    .all();
  return page(records.map((record) => webhookView(ctx, record)));
});
