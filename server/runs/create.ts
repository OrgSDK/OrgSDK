import { findIdempotentRun } from "./queries";
import { z } from "zod";
import { actionVersion } from "../actions/versions";
import type * as resourceTables from "../db/schema";
import {
  authorizeVersion,
  projectGrant,
  scope,
  tx,
  workspace,
} from "../domain/permissions";
import { type ServiceContext } from "../application";
import { ServiceError } from "../shared/errors";
import { projectSnapshot } from "../projects/snapshot";
import { findTestSuite } from "../actions/version-queries";
import { projectsRepository } from "../repositories/projects";
import { runsRepository } from "../repositories/runs";
import { workspaceSettingsForWorkspace } from "../repositories/workspace-settings";
import {
  jsonValue,
  object,
  schema,
  sourceText,
  validateContract,
} from "../shared/contracts";
import { digest } from "../shared/security";
import { choice, text } from "../shared/validation";
import type { CreateRunInput } from "./schemas";
export function createRun(ctx: ServiceContext, body: CreateRunInput) {
  return tx(ctx, (ctx) => createRunInTransaction(ctx, body));
}

function createRunInTransaction(ctx: ServiceContext, body: CreateRunInput) {
  const workspaceId = workspace(ctx);
  const project = projectsRepository(ctx).find(text(body.project, "project"));
  const operation = choice(
    body.operation,
    ["action", "code", "validate", "test"],
    "operation",
  );
  const key = text(body.idempotency_key, "idempotency key", 200);
  const inputs = jsonValue(body.inputs ?? {}, "Inputs");
  if (!project.enabled) {
    throw new ServiceError("FORBIDDEN", "Project is disabled.");
  }
  const setting = workspaceSettingsForWorkspace(ctx.db, workspaceId);
  if (setting && !setting.enabled) {
    throw new ServiceError("FORBIDDEN", "Workspace execution is disabled.");
  }
  let version: typeof resourceTables.actionVersions.$inferSelect | null = null;
  let action: typeof resourceTables.actions.$inferSelect | null = null;
  let suite: typeof resourceTables.actionTestSuites.$inferSelect | null = null;
  if (operation === "action" || operation === "test") {
    ({ action, version } = actionVersion(
      ctx,
      text(body.action, "action"),
      body.version,
    ));
    if (action.projectId !== project.id || !action.enabled) {
      throw new ServiceError(
        "BAD_REQUEST",
        "An enabled action belonging to this project is required.",
      );
    }
    scope(ctx, operation === "test" ? "actions:test" : "actions:run");
    authorizeVersion(ctx, action, version, body.version !== undefined);
    if (operation === "action") {
      validateContract(version.inputSchema, inputs);
    }
    if (operation === "test") {
      if (
        !Number.isInteger(body.version) ||
        typeof body.suite_revision !== "number" ||
        !Number.isInteger(body.suite_revision)
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Tests require a version and suite revision.",
        );
      }
      suite = findTestSuite(ctx, version.id, body.suite_revision) ?? null;
      if (!suite) {
        throw new ServiceError("NOT_FOUND", "Test suite not found.");
      }
    }
    if (body.source !== undefined) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Source is only accepted for code or validation runs.",
      );
    }
  } else {
    scope(ctx, operation === "code" ? "code:execute" : "actions:write");
    projectGrant(ctx, project.id);
    sourceText(body.source);
    if (body.action || body.version || body.conversation) {
      throw new ServiceError(
        "BAD_REQUEST",
        "Code runs cannot select an action, version or conversation.",
      );
    }
  }
  if (body.conversation) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Conversations are archived and cannot accept new runs.",
    );
  }
  if (
    operation !== "validate" &&
    (body.input_schema !== undefined || body.output_schema !== undefined)
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Schemas are only accepted for validation jobs.",
    );
  }
  const snapshot = z
    .record(z.string(), z.json())
    .parse(projectSnapshot(ctx, project.id, operation));
  const source = version?.source ?? sourceText(body.source);
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
  if (version) {
    Object.assign(snapshot, {
      version: version.number,
      validation_mode: version.validationMode,
      input_schema: version.inputSchema,
      output_schema: version.outputSchema,
    });
  }
  if (operation === "validate") {
    Object.assign(snapshot, {
      validation_mode: "semantic",
      input_schema: schema(body.input_schema),
      output_schema: schema(body.output_schema),
    });
  }
  if (suite) {
    Object.assign(snapshot, {
      validation_mode: "semantic",
      test_suite: {
        id: suite.id,
        revision: suite.number,
        digest: suite.digest,
        cases: suite.cases,
      },
    });
  }
  const namespace = ctx.token?.id ?? "";
  return tx(ctx, (ctx) => {
    const existing = findIdempotentRun(ctx, namespace, key);
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
          testSuiteId(existing.snapshot.test_suite) !==
            testSuiteId(snapshot.test_suite))
      ) {
        throw new ServiceError(
          "BAD_REQUEST",
          "Idempotency key already used for a different request.",
        );
      }
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
