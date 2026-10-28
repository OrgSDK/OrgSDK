import { desc, eq } from "drizzle-orm";
import { webhookDeliveries, type webhooks } from "../db/schema";
import { type ServiceContext } from "../application";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { runsRepository } from "../repositories/runs";
import { workspace } from "../domain/permissions";
import { and } from "drizzle-orm";

export function webhookView(
  context: ServiceContext,
  webhook: typeof webhooks.$inferSelect,
) {
  const version = actionVersionsRepository(context).find(
    webhook.actionVersionId,
  );
  const action = actionsRepository(context).find(version.actionId);
  const deliveries = context.db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.workspaceId, workspace(context)),
        eq(webhookDeliveries.webhookId, webhook.id),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(20)
    .all();
  return {
    id: webhook.id,
    name: webhook.name,
    action_id: action.id,
    action_name: action.name,
    version: version.number,
    enabled: webhook.enabled,
    endpoint: `/webhooks/${webhook.id}`,
    rotated_at: webhook.rotatedAt,
    last_received_at: webhook.lastReceivedAt,
    last_accepted_at: webhook.lastAcceptedAt,
    last_rejection: webhook.lastRejection,
    last_rejected_at: webhook.lastRejectedAt,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      delivery_id: delivery.deliveryId,
      received_at: delivery.createdAt,
      outcome: delivery.outcome,
      run: delivery.runId,
      run_status: delivery.runId
        ? runsRepository(context).find(delivery.runId).status
        : null,
    })),
  };
}
