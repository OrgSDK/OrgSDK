import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import * as resourceTables from "../db/schema";
import * as schema from "../db/schema";
import { memberships } from "../db/schema/core";
import { tx } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, json } from "../http/responses";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { identityRepository } from "../repositories/identity";
import { runsRepository } from "../repositories/runs";
import { webhookDeliveriesRepository } from "../repositories/webhook-deliveries";
import { webhooksRepository } from "../repositories/webhooks";
import { createRun } from "../runs/create";
import { jsonValue, object } from "../shared/contracts";
import { now } from "../shared/records";
import { digest } from "../shared/security";
import { canonicalJson } from "../shared/validation";
export async function handleWebhookIngress(
  ctx: AppContext,
): Promise<Response | null> {
  const match = new URL(ctx.request.url).pathname.match(
    /^\/webhooks\/([^/]+)$/,
  );
  if (!match) {
    return null;
  }
  if (ctx.request.method !== "POST") {
    throw new HttpError(405, "Method not allowed.");
  }
  const hook = ctx.db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, match[1]!))
    .get();
  if (!hook || !ctx.workspace || hook.workspaceId !== ctx.workspace.id) {
    throw new HttpError(404, "Webhook not found.");
  }
  const secret = ctx.request.headers.get("x-webhook-secret") ?? "";
  const expected = Buffer.from(hook.secretHash, "hex");
  const actual = Buffer.from(digest(secret), "hex");
  if (
    secret.length > 256 ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new HttpError(403, "Webhook authentication failed.");
  }
  const delivery = ctx.request.headers.get("x-webhook-delivery") ?? "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(delivery)) {
    throw new HttpError(400, "Invalid delivery id.");
  }
  if (
    (ctx.request.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    throw new HttpError(415, "JSON required.");
  }
  const bytes = await ctx.request.arrayBuffer();
  if (bytes.byteLength > 200000) {
    throw new HttpError(413, "Payload too large.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new HttpError(400, "Invalid payload.");
  }
  if (!object(payload) || Object.keys(payload).join() !== "inputs") {
    throw new HttpError(400, "Invalid payload.");
  }
  jsonValue(payload.inputs, "Inputs");
  const actor = identityRepository(ctx.db).user(hook.actorId);
  const member = ctx.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, hook.actorId),
        eq(memberships.workspaceId, hook.workspaceId),
      ),
    )
    .get();
  if (!hook.enabled || !actor || !member) {
    throw new HttpError(403, "Webhook is unavailable.");
  }
  const actorCtx: AppContext = {
    ...ctx,
    user: actor,
    role: member.role,
    token: null,
  };
  const version = actionVersionsRepository(actorCtx).find(hook.actionVersionId);
  const action = actionsRepository(actorCtx).find(version.actionId);
  const hash = digest(canonicalJson(payload));
  return tx(actorCtx, (actorCtx) => {
    const current = webhooksRepository(actorCtx).find(hook.id);
    if (!current.enabled || current.secretHash !== hook.secretHash) {
      throw new HttpError(403, "Webhook is unavailable.");
    }
    const old = webhookDeliveriesRepository(actorCtx).list(
      and(
        eq(resourceTables.webhookDeliveries.webhookId, hook.id),
        eq(resourceTables.webhookDeliveries.deliveryId, delivery),
      ),
    )[0];
    if (old) {
      if (old.payloadHash !== hash) {
        throw new HttpError(
          409,
          "Delivery id was already used with a different payload.",
        );
      }
      return json(
        { run: old.runId, outcome: old.outcome, duplicate: true },
        old.runId ? 200 : 400,
      );
    }
    const run = createRun(actorCtx, {
      project: action.projectId,
      operation: "action",
      action: action.id,
      version: version.number,
      inputs: z.record(z.string(), z.json()).parse(payload.inputs),
      idempotency_key: `webhook:${hook.id}:${delivery}`,
    });
    runsRepository(actorCtx).update(run.id, {
      origin: "webhook",
      originReference: hook.id,
    });
    webhookDeliveriesRepository(actorCtx).create({
      webhookId: hook.id,
      deliveryId: delivery,
      payloadHash: hash,
      outcome: "accepted",
      runId: run.id,
    });
    webhooksRepository(actorCtx).update(hook.id, {
      lastReceivedAt: now(),
      lastAcceptedAt: now(),
    });
    return json({ run: run.id, outcome: "accepted", duplicate: false }, 202);
  });
}
