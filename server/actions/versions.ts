import { and, eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { actionVersionsRepository } from "../repositories/action-versions";
import { actionsRepository } from "../repositories/actions";
import { jsonValue, schema, sourceText } from "../shared/contracts";
import { text } from "../shared/validation";
import type { VersionInput } from "./schemas";
import { findVersion } from "./version-queries";
export function actionVersion(
  ctx: ServiceContext,
  actionId: string,
  number?: number,
) {
  const action = actionsRepository(ctx).find(actionId);
  const version = findVersion(ctx, action.id, number);
  if (!version) {
    throw new ServiceError("NOT_FOUND", "Action version not found.");
  }
  return { action, version };
}

export function resolveActionForSave(
  ctx: ServiceContext,
  projectId: string,
  name: string,
  id?: string,
) {
  const actionName = text(name, "name");
  if (id) {
    const action = actionsRepository(ctx).find(text(id, "action"));
    if (action.projectId !== projectId) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Action belongs to another project.",
      );
    }
    return action;
  }
  const matches = actionsRepository(ctx).list(
    and(
      eq(resourceTables.actions.projectId, projectId),
      eq(resourceTables.actions.name, actionName),
    ),
  );
  if (matches.length > 1) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Multiple actions have this name. Supply an exact action ID.",
    );
  }
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
  ctx: ServiceContext,
  action: typeof resourceTables.actions.$inferSelect,
  body: VersionInput,
  promotedFrom: string | null = null,
) {
  const source = sourceText(body.source);
  const inputSchema = schema(body.input_schema);
  const outputSchema = schema(body.output_schema);
  const sdkContract = jsonValue(body.sdk_contract ?? {}, "SDK contract");
  const latest = findVersion(ctx, action.id);
  if (
    latest &&
    latest.source === source &&
    JSON.stringify(latest.inputSchema) === JSON.stringify(inputSchema) &&
    JSON.stringify(latest.outputSchema) === JSON.stringify(outputSchema) &&
    latest.promotedFrom === promotedFrom &&
    JSON.stringify(latest.sdkContract) === JSON.stringify(sdkContract)
  ) {
    return latest;
  }
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
