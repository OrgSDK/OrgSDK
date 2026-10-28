import { and, eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { schema, sourceText } from "../shared/contracts";
import { text } from "../shared/validation";
export function actionVersion(
  ctx: AppContext,
  actionId: string,
  number?: number,
) {
  const action = actionsRepository(ctx).find(actionId);
  const versions = actionVersionsRepository(ctx)
    .list(eq(resourceTables.actionVersions.actionId, action.id))
    .sort((a, b) => b.number - a.number);
  const version =
    number === undefined
      ? versions[0]
      : versions.find((x) => x.number === number);
  if (!version) throw new HttpError(404, "Action version not found.");
  return { action, version };
}

export function resolveActionForSave(
  ctx: AppContext,
  projectId: string,
  name: unknown,
  id?: string,
) {
  const actionName = text(name, "name");
  if (id) {
    const action = actionsRepository(ctx).find(id);
    if (action.projectId !== projectId)
      throw new HttpError(400, "Action belongs to another project.");
    return action;
  }
  const matches = actionsRepository(ctx).list(
    and(
      eq(resourceTables.actions.projectId, projectId),
      eq(resourceTables.actions.name, actionName),
    ),
  );
  if (matches.length > 1)
    throw new HttpError(
      400,
      "Multiple actions have this name. Supply an exact action ID.",
    );
  return (
    matches[0] ??
    actionsRepository(ctx).create({
      projectId,
      name: actionName,
      description: "",
      enabled: true,
    })
  );
}

export function versionForSave(
  ctx: AppContext,
  action: any,
  body: any,
  promotedFrom: string | null = null,
) {
  const source = sourceText(body.source);
  const inputSchema = schema(body.input_schema);
  const outputSchema = schema(body.output_schema);
  const sdkContract = body.sdk_contract ?? {};
  const existing = actionVersionsRepository(ctx)
    .list(eq(resourceTables.actionVersions.actionId, action.id))
    .sort((a, b) => b.number - a.number);
  const latest = existing[0];
  if (
    latest &&
    latest.source === source &&
    JSON.stringify(latest.inputSchema) === JSON.stringify(inputSchema) &&
    JSON.stringify(latest.outputSchema) === JSON.stringify(outputSchema) &&
    latest.promotedFrom === promotedFrom &&
    JSON.stringify(latest.sdkContract) === JSON.stringify(sdkContract)
  )
    return latest;
  return actionVersionsRepository(ctx).create({
    actionId: action.id,
    number: (latest?.number ?? 0) + 1,
    source,
    inputSchema,
    outputSchema,
    validationMode: "semantic",
    sdkContract,
    promotedFrom,
  });
}
