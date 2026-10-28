import { and, eq } from "drizzle-orm";
import { actionVersion } from "../actions/versions";
import * as resourceTables from "../db/schema";
import {
  authorizeVersion,
  isClient,
  projectGrant,
  scope,
  tx,
  workspace,
} from "../domain/permissions";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/responses";
import { projectSnapshot } from "../projects/snapshot";
import { actionTestSuitesRepository } from "../repositories/action-test-suites";
import { projectsRepository } from "../repositories/projects";
import { runsRepository } from "../repositories/runs";
import { workspaceSettingsRepository } from "../repositories/workspace-settings";
import {
  jsonValue,
  object,
  schema,
  sourceText,
  validateContract,
} from "../shared/contracts";
import { digest } from "../shared/security";
import { text } from "../shared/validation";
export function createRun(ctx: AppContext, body: Record<string, any>) {
  workspace(ctx);
  const projectId = body.project ?? body.agent;
  if (body.project && body.agent && body.project !== body.agent)
    throw new HttpError(400, "Project and legacy agent must match.");
  const project = projectsRepository(ctx).find(text(projectId, "project"));
  const operation = body.operation;
  if (!["action", "code", "validate", "test"].includes(operation))
    throw new HttpError(400, "Unsupported operation.");
  const key = text(body.idempotency_key, "idempotency key", 200);
  const inputs = jsonValue(body.inputs ?? {}, "Inputs");
  if (!project.enabled) throw new HttpError(403, "Project is disabled.");
  const setting = workspaceSettingsRepository(ctx).list()[0];
  if (setting && !setting.enabled)
    throw new HttpError(403, "Workspace execution is disabled.");
  let version: any = null;
  let action: any = null;
  let suite: any = null;
  if (operation === "action" || operation === "test") {
    ({ action, version } = actionVersion(
      ctx,
      text(body.action, "action"),
      body.version,
    ));
    if (action.projectId !== project.id || !action.enabled)
      throw new HttpError(
        400,
        "An enabled action belonging to this project is required.",
      );
    scope(ctx, operation === "test" ? "actions:test" : "actions:run");
    authorizeVersion(ctx, action, version, body.version !== undefined);
    if (operation === "action") validateContract(version.inputSchema, inputs);
    if (operation === "test") {
      if (
        !Number.isInteger(body.version) ||
        !Number.isInteger(body.suite_revision)
      )
        throw new HttpError(400, "Tests require a version and suite revision.");
      suite = actionTestSuitesRepository(ctx).list(
        and(
          eq(resourceTables.actionTestSuites.versionId, version.id),
          eq(resourceTables.actionTestSuites.number, body.suite_revision),
        ),
      )[0];
      if (!suite) throw new HttpError(404, "Test suite not found.");
    }
    if (body.source !== undefined)
      throw new HttpError(
        400,
        "Source is only accepted for code or validation runs.",
      );
  } else {
    scope(ctx, operation === "code" ? "code:execute" : "actions:write");
    projectGrant(ctx, project.id);
    sourceText(body.source);
    if (body.action || body.version || body.conversation)
      throw new HttpError(
        400,
        "Code runs cannot select an action, version or conversation.",
      );
  }
  if (body.conversation)
    throw new HttpError(
      400,
      "Conversations are archived and cannot accept new runs.",
    );
  if (
    operation !== "validate" &&
    (body.input_schema !== undefined || body.output_schema !== undefined)
  )
    throw new HttpError(400, "Schemas are only accepted for validation jobs.");
  const snapshot: any = projectSnapshot(ctx, project.id, operation);
  const source = version?.source ?? body.source;
  Object.assign(snapshot, {
    source,
    source_digest: digest(source),
    protocol_version:
      operation === "validate" ||
      operation === "test" ||
      version?.validationMode === "semantic"
        ? 3
        : 2,
  });
  if (version)
    Object.assign(snapshot, {
      version: version.number,
      validation_mode: version.validationMode,
      input_schema: version.inputSchema,
      output_schema: version.outputSchema,
    });
  if (operation === "validate")
    Object.assign(snapshot, {
      validation_mode: "semantic",
      input_schema: schema(body.input_schema),
      output_schema: schema(body.output_schema),
    });
  if (suite)
    Object.assign(snapshot, {
      validation_mode: "semantic",
      test_suite: {
        id: suite.id,
        revision: suite.number,
        digest: suite.digest,
        cases: suite.cases,
      },
    });
  const namespace = isClient(ctx) ? ctx.token!.id : "";
  return tx(ctx, () => {
    const existing = runsRepository(ctx).list(
      and(
        eq(resourceTables.runs.idempotencyNamespace, namespace),
        eq(resourceTables.runs.idempotencyKey, key),
      ),
    )[0];
    if (existing) {
      if (
        existing.projectId !== project.id ||
        existing.operation !== operation ||
        existing.actorId !== ctx.user?.id ||
        existing.actionVersionId !== (version?.id ?? null) ||
        JSON.stringify(existing.inputs) !== JSON.stringify(inputs) ||
        existing.snapshot.source !== snapshot.source ||
        (operation === "validate" &&
          (JSON.stringify(existing.snapshot.input_schema) !==
            JSON.stringify(snapshot.input_schema) ||
            JSON.stringify(existing.snapshot.output_schema) !==
              JSON.stringify(snapshot.output_schema))) ||
        (operation === "test" &&
          testSuiteId(existing.snapshot.test_suite) !== snapshot.test_suite?.id)
      )
        throw new HttpError(
          400,
          "Idempotency key already used for a different request.",
        );
      return existing;
    }
    const run = runsRepository(ctx).create({
      projectId: project.id,
      actorId: ctx.user!.id,
      tokenId: ctx.token?.id ?? null,
      actionVersionId: version?.id ?? null,
      operation,
      origin: ctx.token ? "client" : "browser",
      originReference: "",
      inputs,
      snapshot,
      status: "queued",
      output: {},
      error: "",
      idempotencyKey: key,
      idempotencyNamespace: namespace,
      retryOf: null,
      cancelRequested: false,
      executorId: null,
      leaseExpiresAt: null,
      deadline: null,
      capabilityHash: "",
    });
    return run;
  });
}

function testSuiteId(value: unknown): unknown {
  return object(value) ? value.id : undefined;
}
