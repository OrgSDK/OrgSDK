import { eq } from "drizzle-orm";
import { actionVersion } from "../actions/versions";
import type * as t from "../db/schema";
import * as resourceTables from "../db/schema";
import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { runsRepository } from "../repositories/runs";
import { webhookDeliveriesRepository } from "../repositories/webhook-deliveries";
import { webhooksRepository } from "../repositories/webhooks";
import { now } from "../shared/records";
import { digest, randomSecret } from "../shared/security";
import { booleanValue, text } from "../shared/validation";
export async function handleWebhooks(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "webhooks") return null;
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  browser(ctx, method !== "GET");

  const view = (r: typeof t.webhooks.$inferSelect) => {
    const version = actionVersionsRepository(ctx).find(r.actionVersionId),
      action = actionsRepository(ctx).find(version.actionId);
    return {
      id: r.id,
      name: r.name,
      action_id: action.id,
      action_name: action.name,
      version: version.number,
      enabled: r.enabled,
      endpoint: `/api/v1/webhook-ingress/${r.id}/`,
      rotated_at: r.rotatedAt,
      last_received_at: r.lastReceivedAt,
      last_accepted_at: r.lastAcceptedAt,
      last_rejection: r.lastRejection,
      last_rejected_at: r.lastRejectedAt,
      deliveries: webhookDeliveriesRepository(ctx)
        .list(eq(resourceTables.webhookDeliveries.webhookId, r.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
        .map((d) => ({
          id: d.id,
          delivery_id: d.deliveryId,
          received_at: d.createdAt,
          outcome: d.outcome,
          run: d.runId,
          run_status: d.runId ? runsRepository(ctx).find(d.runId).status : null,
        })),
    };
  };
  if (resource === "webhooks" && method === "POST" && !id) {
    const b = await body();
    const { action, version } = actionVersion(ctx, text(b.action, "action"));
    if (!action.enabled)
      throw new HttpError(
        400,
        "Choose an enabled action with a saved version.",
      );
    const secret = randomSecret(),
      at = now();
    const hook = webhooksRepository(ctx).create({
      name: text(b.name, "name"),
      actionVersionId: version.id,
      actorId: ctx.user!.id,
      secretHash: digest(secret),
      enabled: booleanValue(b.enabled, true),
      rotatedAt: at,
      lastReceivedAt: null,
      lastAcceptedAt: null,
      lastRejection: "",
      lastRejectedAt: null,
    });
    return json({ webhook: view(hook), secret }, 201);
  }
  if (resource === "webhooks" && id && sub === "rotate" && method === "POST") {
    webhooksRepository(ctx).find(id);
    const secret = randomSecret(),
      hook = webhooksRepository(ctx).update(id, {
        secretHash: digest(secret),
        rotatedAt: now(),
      });
    return json({ webhook: view(hook), secret });
  }
  if (
    resource === "webhooks" &&
    id &&
    !sub &&
    (method === "PATCH" || method === "PUT")
  ) {
    const old = webhooksRepository(ctx).find(id),
      b = await body();
    if (b.action !== undefined)
      throw new HttpError(400, "Register a new webhook to change its action.");
    return json(
      view(
        webhooksRepository(ctx).update(id, {
          name: b.name === undefined ? old.name : text(b.name, "name"),
          enabled: booleanValue(b.enabled, old.enabled),
        }),
      ),
    );
  }
  if (method === "GET" && !id)
    return json(page(webhooksRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(webhooksRepository(ctx).find(id)));
  return null;
}
