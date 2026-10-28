import { actionVersion } from "../actions/versions";
import type * as t from "../db/schema";
import { browser } from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError, input, json, page } from "../http/responses";
import { actionsRepository } from "../repositories/actions";
import { schedulesRepository } from "../repositories/schedules";
import { jsonValue, validateContract } from "../shared/contracts";
import { booleanValue } from "../shared/validation";
import { nextCron } from "./cron";
export async function handleSchedules(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  _subId: string | undefined,
): Promise<Response | null> {
  if (resource !== "schedules") return null;
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  browser(ctx, false);

  const view = (r: typeof t.schedules.$inferSelect) => {
    return {
      id: r.id,
      action: r.actionId,
      cron: r.cron,
      inputs: r.inputs,
      enabled: r.enabled,
      next_run_at: r.nextRunAt,
    };
  };
  if (resource === "schedules" && method === "POST" && !id) {
    const b = await body();
    const action = actionsRepository(ctx).find(b.action);
    if (!action.enabled) throw new HttpError(400, "Action is disabled.");
    const version = actionVersion(ctx, action.id).version;
    const inputs = jsonValue(b.inputs ?? {}, "Inputs");
    validateContract(version.inputSchema, inputs);
    return json(
      view(
        schedulesRepository(ctx).create({
          actionId: action.id,
          actorId: ctx.user!.id,
          cron: b.cron,
          inputs,
          enabled: booleanValue(b.enabled, true),
          nextRunAt: nextCron(b.cron),
        }),
      ),
      201,
    );
  }
  if (
    resource === "schedules" &&
    id &&
    (method === "PATCH" || method === "PUT")
  ) {
    const old = schedulesRepository(ctx).find(id),
      b = await body();
    const action = actionsRepository(ctx).find(b.action ?? old.actionId),
      version = actionVersion(ctx, action.id).version,
      inputs = jsonValue(b.inputs ?? old.inputs, "Inputs");
    validateContract(version.inputSchema, inputs);
    const cron = b.cron ?? old.cron;
    const next =
      cron !== old.cron || (!old.enabled && b.enabled)
        ? nextCron(cron)
        : old.nextRunAt;
    return json(
      view(
        schedulesRepository(ctx).update(id, {
          actionId: action.id,
          cron,
          inputs,
          enabled: booleanValue(b.enabled, old.enabled),
          nextRunAt: next,
        }),
      ),
    );
  }
  if (resource === "schedules" && id && method === "DELETE") {
    schedulesRepository(ctx).find(id);
    schedulesRepository(ctx).remove(id);
    return new Response(null, { status: 204 });
  }
  if (method === "GET" && !id)
    return json(page(schedulesRepository(ctx).list().map(view)));
  if (method === "GET" && id && !sub)
    return json(view(schedulesRepository(ctx).find(id)));
  return null;
}
