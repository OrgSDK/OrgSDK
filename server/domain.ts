import { and, eq, desc } from "drizzle-orm";
import {
  object,
  jsonValue,
  sourceText,
  schema,
  validateContract,
  validateColumns,
  validateValues,
  validateCases,
} from "./domain-validation";
export {
  validateContract,
  validateColumns,
  validateValues,
} from "./domain-validation";
import { CronExpressionParser } from "cron-parser";
import { randomUUID, timingSafeEqual, createHmac } from "node:crypto";
import {
  catalogEntries,
  catalogRelease,
  marketplaceEntries,
} from "./domain-catalog";
export { catalogRelease } from "./domain-catalog";
import { users, memberships } from "./db/core";
import type { AppContext } from "./context";
import { requireWorkspace, requireManager } from "./context";
import { digest, encrypt, randomSecret } from "./security";
import { HttpError, input, json, page } from "./http";
import { handleOAuth } from "./oauth";
import * as t from "./db/domain";

const now = () => new Date().toISOString();
const base = (workspaceId: number) => ({
  id: randomUUID(),
  workspaceId,
  createdAt: now(),
  updatedAt: now(),
});
const text = (value: unknown, name: string, max = 100) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new HttpError(400, `Invalid ${name}.`);
  return value;
};
function booleanValue(value: unknown, fallback: boolean, name = "enabled") {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new HttpError(400, `${name} must be boolean.`);
  return value;
}
function optionalDescription(value: unknown, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.includes("\0"))
    throw new HttpError(400, "Invalid description.");
  return value;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function assertFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Unexpected fields in request.");
}
const tx = <T>(ctx: AppContext, fn: () => T) =>
  ctx.store.sqlite.transaction(fn).immediate();
function workspace(ctx: AppContext) {
  return requireWorkspace(ctx).id;
}
function isClient(ctx: AppContext) {
  return !!ctx.token && ctx.token.scopes.some((s: string) => s.includes(":"));
}
function scope(ctx: AppContext, required: string) {
  if (!ctx.token) return;
  const legacyNeeded = ["catalog:read", "runs:read"].includes(required)
    ? "read"
    : "write";
  if (
    ctx.token.revoked ||
    (isClient(ctx)
      ? !ctx.token.scopes.includes(required)
      : !ctx.token.scopes.includes(legacyNeeded) || required === "actions:test")
  )
    throw new HttpError(403, "Client scope does not permit this operation.");
}
function browser(ctx: AppContext, manager = false) {
  if (isClient(ctx))
    throw new HttpError(403, "This operation requires a browser session.");
  if (ctx.token) {
    const required = ["GET", "HEAD", "OPTIONS"].includes(ctx.request.method)
      ? "read"
      : "write";
    if (!ctx.token.scopes.includes(required))
      throw new HttpError(403, "Token scope does not permit this operation.");
  }
  if (manager) requireManager(ctx);
  else requireWorkspace(ctx);
}
function projectGrant(ctx: AppContext, id: string) {
  if (ctx.token && !ctx.token.projects.includes(id))
    throw new HttpError(403, "Project is outside the client grant.");
}
function find(ctx: AppContext, table: any, id: string): any {
  const row = ctx.store.db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspace(ctx))))
    .get();
  if (!row) throw new HttpError(404, "Not found.");
  return row;
}
function rows(ctx: AppContext, table: any): any[] {
  return ctx.store.db
    .select()
    .from(table)
    .where(eq(table.workspaceId, workspace(ctx)))
    .all();
}
function auditKind(table: any): string | null {
  const names = new Map<any, string>([
    [t.projects, "project"],
    [t.executors, "executor"],
    [t.actions, "action"],
    [t.actionVersions, "action.version"],
    [t.actionTestSuites, "action.tests"],
    [t.plugins, "plugin"],
    [t.credentials, "credential"],
    [t.documents, "document"],
    [t.workspaceTables, "table"],
    [t.tableRows, "row"],
    [t.accessTokens, "token"],
    [t.runs, "run"],
    [t.approvals, "approval"],
    [t.schedules, "schedule"],
    [t.webhooks, "webhook"],
  ]);
  return names.get(table) ?? null;
}
function recordAudit(
  ctx: AppContext,
  table: any,
  id: string,
  operation: string,
) {
  const kind = auditKind(table);
  if (!kind) return;
  ctx.store.db
    .insert(t.auditRecords)
    .values({
      ...base(workspace(ctx)),
      actorId: ctx.user?.id ?? null,
      action: `${kind}.${operation}`,
      resource: id,
      data: {},
    })
    .run();
}
function insert(ctx: AppContext, table: any, data: Record<string, any>) {
  return tx(ctx, () => {
    const row = ctx.store.db
      .insert(table)
      .values({ ...base(workspace(ctx)), ...data })
      .returning()
      .get() as any;
    recordAudit(ctx, table, row.id, "created");
    return row;
  });
}
function update(
  ctx: AppContext,
  table: any,
  id: string,
  data: Record<string, any>,
) {
  return tx(ctx, () => {
    const row = ctx.store.db
      .update(table)
      .set({ ...data, updatedAt: now() })
      .where(and(eq(table.id, id), eq(table.workspaceId, workspace(ctx))))
      .returning()
      .get() as any;
    if (row) recordAudit(ctx, table, id, "updated");
    return row;
  });
}
function remove(ctx: AppContext, table: any, id: string) {
  tx(ctx, () => {
    ctx.store.db
      .delete(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspace(ctx))))
      .run();
    recordAudit(ctx, table, id, "deleted");
  });
}
function serializeProject(ctx: AppContext, row: any) {
  const executor = rows(ctx, t.executors).find((x) => x.projectId === row.id);
  const pluginIds = rows(ctx, t.plugins)
    .filter((x) => x.projectId === row.id)
    .map((x) => x.id);
  const minimal = {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    runner: {
      registered: !!executor,
      enabled: !!executor?.enabled,
      locally_managed: !!executor?.locallyManaged,
      last_seen_at: executor?.lastSeenAt ?? null,
      protocol_version: executor?.protocolVersion ?? null,
    },
  };
  if (isClient(ctx)) return minimal;
  return {
    ...minimal,
    plugins: pluginIds,
    readable_tables: row.readableTables,
    writable_tables: row.writableTables,
    readable_documents: row.readableDocuments,
    writable_documents: row.writableDocuments,
  };
}
function serializeAction(row: any) {
  return {
    id: row.id,
    agent: row.projectId,
    project: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
  };
}
function serializeVersion(row: any) {
  return {
    id: row.id,
    number: row.number,
    source: row.source,
    input_schema: row.inputSchema,
    output_schema: row.outputSchema,
    validation_mode: row.validationMode,
    sdk_contract: row.sdkContract,
    promoted_from: row.promotedFrom,
    created_at: row.createdAt,
  };
}
function actionVersion(ctx: AppContext, actionId: string, number?: number) {
  const action = find(ctx, t.actions, actionId);
  const versions = rows(ctx, t.actionVersions)
    .filter((x) => x.actionId === action.id)
    .sort((a, b) => b.number - a.number);
  const version =
    number === undefined
      ? versions[0]
      : versions.find((x) => x.number === number);
  if (!version) throw new HttpError(404, "Action version not found.");
  return { action, version };
}
function authorizeVersion(
  ctx: AppContext,
  action: any,
  version: any,
  explicit: boolean,
) {
  if (!ctx.token || !isClient(ctx)) return;
  if (ctx.token.projects.includes(action.projectId)) return;
  if (explicit && ctx.token.actionVersions.includes(version.id)) return;
  throw new HttpError(
    403,
    "Client requires an explicit granted action version.",
  );
}
function pluginNamespace(slug: string) {
  const parts = slug.split("-");
  if (!parts.length || parts.some((p) => !/^[a-z][a-z0-9]*$/.test(p)))
    return null;
  const name =
    parts[0]! +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join("");
  const reserved = new Set([
    "actionParams",
    "defineParams",
    "handleWebhook",
    "constants",
    "z",
    "console",
    "resetTimeout",
    "keepAlive",
    "Promise",
    "JSON",
    "Date",
    "Math",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Error",
    "TypeError",
    "RangeError",
    "RegExp",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "NaN",
    "Infinity",
    "undefined",
    "requestApproval",
    "saveArtifact",
    "saveMemory",
    "delegate",
    "reportOutcome",
    "readFile",
    "writeFile",
    "listFiles",
    "removeFile",
    "listTables",
    "getTable",
    "listTableRows",
    "writeTableRow",
    "deleteTableRow",
    "listDocuments",
    "readDocument",
    "writeDocument",
  ]);
  return reserved.has(name) ? null : name;
}
export function projectSnapshot(
  ctx: AppContext,
  projectId: string,
  operation = "code",
) {
  const project = find(ctx, t.projects, projectId);
  const restricted = operation === "validate" || operation === "test";
  const resources = {
    tables: { read: project.readableTables, write: project.writableTables },
    documents: {
      read: project.readableDocuments,
      write: project.writableDocuments,
    },
  };
  const installed = rows(ctx, t.plugins)
    .filter((p) => p.projectId === projectId && p.enabled)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const plugins = installed.map((p) => ({
    slug: p.slug,
    version: p.version,
    source: p.source,
    digest: p.digest,
    credential_id: p.credentialId,
    credential_provider: p.releaseMetadata?.auth?.provider ?? null,
    distribution: p.distribution,
    configuration: p.configuration,
    package_url: p.packageUrl,
    contract_version: 1,
  }));
  const selected = {
    id: project.id,
    name: project.name,
    instructions: "",
    model: "",
    credential_id: null,
    plugins,
    resources,
    documents: [],
  };
  const revision = digest(
    JSON.stringify({ sdk_revision: 3, plugins, resources }),
  );
  const namespaces = installed.map((p) => pluginNamespace(p.slug));
  const sdkPlugins = installed.map((p, i) => {
    const namespace = namespaces[i];
    const available =
      !!namespace && namespaces.filter((n) => n === namespace).length === 1;
    const tools =
      p.distribution === "external" && Array.isArray(p.releaseMetadata?.tools)
        ? p.releaseMetadata.tools
        : null;
    return {
      namespace: available ? namespace : null,
      available,
      slug: p.slug,
      version: p.version,
      digest: p.digest,
      metadata_complete:
        !!available &&
        !!tools &&
        tools.every(
          (tool: any) =>
            object(tool) &&
            typeof tool.name === "string" &&
            /^[a-z][a-zA-Z0-9]*$/.test(tool.name) &&
            Array.isArray(tool.parameters) &&
            tool.parameters.every(
              (x: any) =>
                object(x) &&
                typeof x.name === "string" &&
                typeof x.type === "string",
            ),
        ),
      tools:
        available && tools
          ? tools
              .filter(
                (x: any) => object(x) && typeof x.name === "string" && x.name,
              )
              .map((x: any) =>
                Object.fromEntries(
                  Object.entries({ ...x, calling: "named" }).filter(([key]) =>
                    [
                      "name",
                      "description",
                      "parameters",
                      "returns",
                      "returnType",
                      "calling",
                    ].includes(key),
                  ),
                ),
              )
          : null,
    };
  });
  const sdk = {
    project: project.id,
    protocol_version: 2,
    sdk_revision: 3,
    configuration_revision: revision,
    resources,
    plugins: sdkPlugins,
    limits: {
      source_utf8_bytes: 200000,
      inputs_json_utf8_bytes: 200000,
      result_json_limit: 1000000,
      event_count: 200,
      string_chars: 4096,
      value_bytes: 16384,
      queue_bytes: 262144,
      idle_timeout_ms: 300000,
      events_page_size: 100,
      file_utf8_bytes: 200000,
      files_page_size: 100,
      files_scan_entries: 10000,
      file_path_utf8_bytes: 4096,
      data_json_utf8_bytes: 200000,
      data_page_size: 100,
    },
    builtins: [
      "defineParams<T>(schema: z.ZodType<T>): T",
      "requestApproval(prompt: string): Promise<boolean>",
      "saveArtifact(name: string, content: string): Promise<unknown>",
      "readFile(path: string): Promise<string>",
      "writeFile(path: string, content: string): Promise<{path: string; bytes: number}>",
      "listFiles(path?: string, offset?: number, limit?: number): Promise<unknown>",
      "removeFile(path: string): Promise<void>",
      "listTables(offset?: number, limit?: number): Promise<unknown>",
      "getTable(tableId: string): Promise<unknown>",
      "listTableRows(tableId: string, offset?: number, limit?: number): Promise<unknown>",
      "writeTableRow(tableId: string, tableRevision: number, values: object, rowId?: string, revision?: number): Promise<unknown>",
      "deleteTableRow(tableId: string, rowId: string, revision: number): Promise<unknown>",
      "listDocuments(offset?: number, limit?: number): Promise<unknown>",
      "readDocument(documentId: string): Promise<unknown>",
      "writeDocument(documentId: string, title: string, content: string): Promise<unknown>",
      "console.log(...values: unknown[]): void",
      "console.warn(...values: unknown[]): void",
      "console.error(...values: unknown[]): void",
    ],
    notes:
      "Plugin metadata is pinned and read without executing plugin code. Missing metadata is unknown; do not infer signatures. Plugin functions are called through their namespace. Return explicitly. Files are UTF-8 text inside the project workspace and require a Linux executor. Table and document operations require explicit project resource grants; write grants include read access. Schema and grant management stay outside execution.",
    example:
      "const params = defineParams(z.object({ value: z.number() }));\nreturn params.value + 1;",
  };
  const runAgent = restricted
    ? {
        ...selected,
        plugins: [],
        resources: {
          tables: { read: [], write: [] },
          documents: { read: [], write: [] },
        },
      }
    : selected;
  return {
    agents: [runAgent],
    root_agent_id: project.id,
    sdk_revision: 3,
    configuration_revision: revision,
    sdk,
  };
}
export function serializeRun(_ctx: AppContext, row: any) {
  return {
    id: row.id,
    agent: row.projectId,
    project: row.projectId,
    origin: row.origin,
    origin_reference: row.originReference,
    conversation: null,
    actor: row.actorId,
    client_token: row.tokenId,
    source: row.snapshot.source ?? null,
    source_digest: row.snapshot.source_digest ?? null,
    sdk_revision: row.snapshot.sdk_revision ?? null,
    configuration_revision: row.snapshot.configuration_revision ?? null,
    operation: row.operation,
    action_version: row.actionVersionId,
    inputs: row.inputs,
    status: row.status,
    output: row.output,
    error: row.error,
    retry_of: row.retryOf,
    cancel_requested: row.cancelRequested,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
export function createRun(ctx: AppContext, body: Record<string, any>) {
  const workspaceId = workspace(ctx);
  const projectId = body.project ?? body.agent;
  if (body.project && body.agent && body.project !== body.agent)
    throw new HttpError(400, "Project and legacy agent must match.");
  const project = find(ctx, t.projects, text(projectId, "project"));
  const operation = body.operation;
  if (!["action", "code", "validate", "test"].includes(operation))
    throw new HttpError(400, "Unsupported operation.");
  const key = text(body.idempotency_key, "idempotency key", 200);
  const inputs = jsonValue(body.inputs ?? {}, "Inputs");
  if (!project.enabled) throw new HttpError(403, "Project is disabled.");
  const setting = rows(ctx, t.workspaceSettings)[0];
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
      suite = rows(ctx, t.actionTestSuites).find(
        (s) => s.versionId === version.id && s.number === body.suite_revision,
      );
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
    const existing = rows(ctx, t.runs).find(
      (r) => r.idempotencyNamespace === namespace && r.idempotencyKey === key,
    );
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
          existing.snapshot.test_suite?.id !== snapshot.test_suite?.id)
      )
        throw new HttpError(
          400,
          "Idempotency key already used for a different request.",
        );
      return existing;
    }
    const run = insert(ctx, t.runs, {
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
function resolveActionForSave(
  ctx: AppContext,
  projectId: string,
  name: unknown,
  id?: string,
) {
  const actionName = text(name, "name");
  if (id) {
    const action = find(ctx, t.actions, id);
    if (action.projectId !== projectId)
      throw new HttpError(400, "Action belongs to another project.");
    return action;
  }
  const matches = rows(ctx, t.actions).filter(
    (action) => action.projectId === projectId && action.name === actionName,
  );
  if (matches.length > 1)
    throw new HttpError(
      400,
      "Multiple actions have this name. Supply an exact action ID.",
    );
  return (
    matches[0] ??
    insert(ctx, t.actions, {
      projectId,
      name: actionName,
      description: "",
      enabled: true,
    })
  );
}
function versionForSave(
  ctx: AppContext,
  action: any,
  body: any,
  promotedFrom: string | null = null,
) {
  const source = sourceText(body.source);
  const inputSchema = schema(body.input_schema);
  const outputSchema = schema(body.output_schema);
  const sdkContract = body.sdk_contract ?? {};
  const existing = rows(ctx, t.actionVersions)
    .filter((v) => v.actionId === action.id)
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
  return insert(ctx, t.actionVersions, {
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
function authoringGrant(ctx: AppContext, id: string) {
  if (isClient(ctx)) projectGrant(ctx, id);
}
function authorizeRunRead(
  ctx: AppContext,
  run: any,
  requestedScope: string | null = "runs:read",
) {
  if (requestedScope) scope(ctx, requestedScope);
  if (
    isClient(ctx) &&
    ctx.token &&
    (run.tokenId !== ctx.token.id ||
      !(
        ctx.token.projects.includes(run.projectId) ||
        (run.actionVersionId &&
          ctx.token.actionVersions.includes(run.actionVersionId))
      ))
  )
    throw new HttpError(404, "Not found.");
}
function projectValues(ctx: AppContext, body: any, old?: any) {
  if (["model", "instructions", "credential"].some((key) => key in body))
    throw new HttpError(400, "Model and reasoning configuration is retired.");
  const values: any = {
    name: body.name === undefined ? old?.name : text(body.name, "name"),
    enabled: body.enabled === undefined ? (old?.enabled ?? true) : body.enabled,
  };
  if (typeof values.enabled !== "boolean")
    throw new HttpError(400, "Enabled must be boolean.");
  for (const [field, key, table] of [
    ["readableTables", "readable_tables", t.workspaceTables],
    ["writableTables", "writable_tables", t.workspaceTables],
    ["readableDocuments", "readable_documents", t.documents],
    ["writableDocuments", "writable_documents", t.documents],
  ] as const) {
    if (body[key] !== undefined) {
      browser(ctx, true);
      if (ctx.token)
        throw new HttpError(
          403,
          "Resource grants require a workspace manager browser session.",
        );
      if (
        !Array.isArray(body[key]) ||
        body[key].some((id: unknown) => typeof id !== "string")
      )
        throw new HttpError(400, `Invalid ${key}.`);
      for (const id of body[key]) find(ctx, table, id);
    }
    values[field] = body[key] ?? old?.[field] ?? [];
  }
  return values;
}
function tokenView(row: any) {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    projects: row.projects,
    action_versions: row.actionVersions,
    revoked: row.revoked,
    created_at: row.createdAt,
    activity_state: row.revoked
      ? "revoked"
      : !row.lastUsedAt
        ? "never_used"
        : Date.now() - Date.parse(row.lastUsedAt) < 7 * 86400000
          ? "recently_used"
          : "inactive",
    first_used_at: row.firstUsedAt,
    last_used_at: row.lastUsedAt,
    request_count: row.requestCount,
    success_count: row.successCount,
    error_count: row.errorCount,
    rest_request_count: row.restRequestCount,
    mcp_request_count: row.mcpRequestCount,
    last_transport: row.lastTransport,
    last_outcome: row.lastOutcome,
    last_status_code: row.lastStatusCode,
  };
}
export function standard(row: any) {
  return {
    id: row.id,
    name: row.name,
    columns: row.columns,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
export function rowView(row: any) {
  return {
    id: row.id,
    values: row.values,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
function checkRevision(row: any, revision: any) {
  if (!Number.isInteger(revision) || revision < 1)
    throw new HttpError(400, "A positive revision is required.");
  if (row.revision !== revision)
    throw new HttpError(
      409,
      "This record changed. Reload it before saving again.",
    );
}

function streamRun(ctx: AppContext, run: any) {
  const query = new URL(ctx.request.url).searchParams;
  const cursor = Number(
    ctx.request.headers.get("last-event-id") ?? query.get("after") ?? 0,
  );
  if (!Number.isInteger(cursor) || cursor < 0)
    throw new HttpError(400, "Invalid event cursor.");
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let after = cursor;
      try {
        for (let poll = 0; poll < 30 && !cancelled; poll++) {
          const membership = ctx.store.db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, run.workspaceId),
                eq(memberships.userId, ctx.user!.id),
              ),
            )
            .get();
          if (!membership) break;
          if (ctx.token) {
            const token = ctx.store.db
              .select()
              .from(t.accessTokens)
              .where(eq(t.accessTokens.id, ctx.token.id))
              .get();
            if (!token || token.revoked) break;
            try {
              authorizeRunRead({ ...ctx, token }, run);
            } catch {
              break;
            }
          }
          const current = ctx.store.db
            .select()
            .from(t.runs)
            .where(eq(t.runs.id, run.id))
            .get();
          if (!current) break;
          const batch = ctx.store.db
            .select()
            .from(t.runEvents)
            .where(eq(t.runEvents.runId, run.id))
            .all()
            .filter((e) => e.sequence > after)
            .sort((a, b) => a.sequence - b.sequence)
            .slice(0, 100);
          for (const event of batch) {
            after = event.sequence;
            controller.enqueue(
              encoder.encode(
                `id: ${after}\ndata: ${JSON.stringify({ sequence: event.sequence, kind: event.kind, data: event.data })}\n\n`,
              ),
            );
          }
          if (
            ["succeeded", "failed", "cancelled", "interrupted"].includes(
              current.status,
            ) &&
            batch.length < 100
          ) {
            controller.enqueue(encoder.encode("event: complete\ndata: {}\n\n"));
            break;
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
        return;
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
function suiteView(s: any) {
  return {
    id: s.id,
    version: s.versionId,
    revision: s.number,
    digest: s.digest,
    cases: s.cases,
    created_at: s.createdAt,
  };
}
function nextCron(cron: any) {
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5)
    throw new HttpError(400, "Use a valid five-field UTC cron expression.");
  try {
    return CronExpressionParser.parse(cron, { tz: "UTC" }).next().toISOString();
  } catch {
    throw new HttpError(400, "Use a valid five-field UTC cron expression.");
  }
}
async function handleExecutorRoute(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (
    (resource === "projects" || resource === "agents") &&
    id &&
    sub === "executor"
  ) {
    browser(ctx, true);
    find(ctx, t.projects, id);
    if (method !== "POST" && method !== "DELETE")
      throw new HttpError(405, "Method not allowed.");
    const b = method === "POST" ? await body() : {};
    const locallyManaged = b.locally_managed ?? false;
    if (typeof locallyManaged !== "boolean")
      throw new HttpError(400, "locally_managed must be boolean.");
    const bootstrap = process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN;
    if (method === "POST" && locallyManaged && !bootstrap)
      throw new HttpError(400, "Local executor management is not configured.");
    return tx(ctx, () => {
      let worker = rows(ctx, t.executors).find((e) => e.projectId === id);
      if (worker) {
        for (const run of rows(ctx, t.runs).filter(
          (r) =>
            r.executorId === worker.id &&
            ["running", "waiting_approval"].includes(r.status),
        )) {
          update(ctx, t.runs, run.id, {
            status: "cancelled",
            cancelRequested: true,
            capabilityHash: "",
            executorId: null,
            leaseExpiresAt: null,
          });
          for (const approval of rows(ctx, t.approvals).filter(
            (a) => a.runId === run.id && a.status === "pending",
          ))
            update(ctx, t.approvals, approval.id, { status: "interrupted" });
        }
        worker = update(ctx, t.executors, worker.id, {
          enabled: false,
          locallyManaged: false,
          registrationNonce: randomUUID(),
          tokenHash: digest(randomSecret()),
        });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      const nonce = randomUUID(),
        secret = randomSecret(),
        pool = rows(ctx, t.workspaceSettings)[0]?.executionPool ?? "shared";
      if (worker)
        worker = update(ctx, t.executors, worker.id, {
          enabled: true,
          locallyManaged,
          registrationNonce: nonce,
          tokenHash: digest(secret),
          protocolVersion: 1,
          capabilities: [],
          lastSeenAt: null,
          pool,
        });
      else
        worker = insert(ctx, t.executors, {
          projectId: id,
          name: `project-${id}`,
          pool,
          tokenHash: digest(secret),
          registrationNonce: nonce,
          locallyManaged,
          enabled: true,
          protocolVersion: 1,
          capabilities: [],
          lastSeenAt: null,
        });
      const token = locallyManaged
        ? createHmac("sha256", bootstrap!)
            .update(`${worker.id}:${nonce}`)
            .digest("hex")
        : secret;
      if (locallyManaged)
        worker = update(ctx, t.executors, worker.id, {
          tokenHash: digest(token),
        });
      return json({ executor_id: worker.id, agent_id: id, token });
    });
  }
  return null;
}

async function handleProjects(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "projects" || resource === "agents") {
    if (method === "GET") {
      scope(ctx, "catalog:read");
      if (id && sub === "sdk") {
        projectGrant(ctx, id);
        return json(projectSnapshot(ctx, id).sdk);
      }
      if (id && sub) throw new HttpError(405, "Operation is not implemented.");
      if (id) {
        const project = find(ctx, t.projects, id);
        if (
          isClient(ctx) &&
          ctx.token &&
          !ctx.token.projects.includes(id) &&
          !rows(ctx, t.actions).some(
            (a) =>
              a.projectId === id &&
              rows(ctx, t.actionVersions).some(
                (v) =>
                  v.actionId === a.id &&
                  ctx.token!.actionVersions.includes(v.id),
              ),
          )
        )
          throw new HttpError(404, "Not found.");
        return json(serializeProject(ctx, project));
      }
      return json(
        page(
          rows(ctx, t.projects)
            .filter(
              (p) =>
                !isClient(ctx) ||
                ctx.token!.projects.includes(p.id) ||
                rows(ctx, t.actions).some(
                  (a) =>
                    a.projectId === p.id &&
                    rows(ctx, t.actionVersions).some(
                      (v) =>
                        v.actionId === a.id &&
                        ctx.token!.actionVersions.includes(v.id),
                    ),
                ),
            )
            .map((p) => serializeProject(ctx, p)),
        ),
      );
    }
    browser(ctx, true);
    if (sub) throw new HttpError(405, "Operation is not implemented.");
    if (method === "POST" && !id) {
      const data = projectValues(ctx, await body());
      const row = tx(ctx, () => {
        const p = insert(ctx, t.projects, data);
        return p;
      });
      return json(serializeProject(ctx, row), 201);
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const old = find(ctx, t.projects, id);
      const data = projectValues(ctx, await body(), old);
      const row = tx(ctx, () => {
        const p = update(ctx, t.projects, id, data);
        return p;
      });
      return json(serializeProject(ctx, row));
    }
    if (id && method === "DELETE") {
      find(ctx, t.projects, id);
      if (
        rows(ctx, t.runs).some((r) => r.projectId === id) ||
        rows(ctx, t.actions).some((a) => a.projectId === id)
      )
        throw new HttpError(409, "Project has retained runs or actions.");
      tx(ctx, () => {
        remove(ctx, t.projects, id);
      });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}

async function handleRuns(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "runs") {
    if (method === "POST" && !id)
      return json(serializeRun(ctx, createRun(ctx, await body())), 201);
    if (method === "GET" && !id) {
      scope(ctx, "runs:read");
      return json(
        page(
          rows(ctx, t.runs)
            .filter(
              (r) =>
                !isClient(ctx) ||
                (r.tokenId === ctx.token!.id &&
                  (ctx.token!.projects.includes(r.projectId) ||
                    ctx.token!.actionVersions.includes(r.actionVersionId))),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((r) => serializeRun(ctx, r)),
        ),
      );
    }
    if (id) {
      const run = find(ctx, t.runs, id);
      authorizeRunRead(
        ctx,
        run,
        sub === "retry" && method === "POST"
          ? null
          : sub === "cancel"
            ? "runs:cancel"
            : "runs:read",
      );
      if (method === "GET" && !sub) return json(serializeRun(ctx, run));
      if (method === "GET" && sub === "stream") return streamRun(ctx, run);
      if (method === "GET" && sub === "events")
        return json(
          rows(ctx, t.runEvents)
            .filter((e) => e.runId === id)
            .sort((a, b) => a.sequence - b.sequence)
            .map((e) => ({
              sequence: e.sequence,
              kind: e.kind,
              data: e.data,
              created_at: e.createdAt,
            })),
        );
      if (method === "POST" && sub === "retry") {
        if (!["failed", "cancelled", "interrupted"].includes(run.status))
          throw new HttpError(
            400,
            "Only failed, cancelled or interrupted runs can be retried.",
          );
        const b = await body();
        const key = text(b.idempotency_key, "idempotency key", 200);
        scope(
          ctx,
          run.operation === "code"
            ? "code:execute"
            : run.operation === "validate"
              ? "actions:write"
              : run.operation === "test"
                ? "actions:test"
                : "actions:run",
        );
        if (run.actionVersionId) {
          const v = find(ctx, t.actionVersions, run.actionVersionId);
          authorizeVersion(ctx, find(ctx, t.actions, v.actionId), v, true);
        } else projectGrant(ctx, run.projectId);
        const retry = tx(ctx, () => {
          const existing = rows(ctx, t.runs).find(
            (r) =>
              r.idempotencyNamespace === (isClient(ctx) ? ctx.token!.id : "") &&
              r.idempotencyKey === key,
          );
          if (existing) {
            if (existing.retryOf !== run.id)
              throw new HttpError(
                400,
                "Idempotency key already used for a different request.",
              );
            return existing;
          }
          const copy = insert(ctx, t.runs, {
            projectId: run.projectId,
            actorId: ctx.user!.id,
            tokenId: ctx.token?.id ?? null,
            actionVersionId: run.actionVersionId,
            operation: run.operation,
            origin: "retry",
            originReference: run.id,
            inputs: run.inputs,
            snapshot: run.snapshot,
            status: "queued",
            output: {},
            error: "",
            idempotencyKey: key,
            idempotencyNamespace: isClient(ctx) ? ctx.token!.id : "",
            retryOf: run.id,
            cancelRequested: false,
            executorId: null,
            leaseExpiresAt: null,
            deadline: null,
            capabilityHash: "",
          });
          return copy;
        });
        return json(serializeRun(ctx, retry), 201);
      }
      if (method === "POST" && sub === "promote") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, run.projectId);
        if (run.operation !== "code")
          throw new HttpError(400, "Only one-off code runs can be promoted.");
        const b = await body();
        return json(
          tx(ctx, () => {
            const action = resolveActionForSave(
              ctx,
              run.projectId,
              b.name,
              b.action,
            );
            return {
              action: action.id,
              version: serializeVersion(
                versionForSave(
                  ctx,
                  action,
                  {
                    ...b,
                    source: run.snapshot.source,
                    sdk_contract: {
                      sdk_revision: run.snapshot.sdk_revision,
                      configuration_revision:
                        run.snapshot.configuration_revision,
                      sdk: run.snapshot.sdk,
                    },
                  },
                  run.id,
                ),
              ),
            };
          }),
          201,
        );
      }
      if (method === "POST" && sub === "cancel")
        return json(
          serializeRun(
            ctx,
            tx(ctx, () => {
              if (
                ["queued", "running", "waiting_approval"].includes(run.status)
              ) {
                const state =
                  run.status === "queued" ? "cancelled" : run.status;
                const updated = update(ctx, t.runs, id, {
                  status: state,
                  cancelRequested: true,
                });
                for (const approval of rows(ctx, t.approvals).filter(
                  (a) => a.runId === id && a.status === "pending",
                ))
                  update(ctx, t.approvals, approval.id, {
                    status: "interrupted",
                  });
                return updated;
              }
              return run;
            }),
          ),
        );
    }
  }
  return null;
}

async function handleActions(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "actions") {
    if (id === "validate-code" && method === "POST") {
      const b = await body();
      return json(
        serializeRun(ctx, createRun(ctx, { ...b, operation: "validate" })),
        201,
      );
    }
    if (id === "save-action" && method === "POST") {
      const b = await body();
      scope(ctx, "actions:write");
      const projectId = b.project ?? b.agent;
      if (b.project && b.agent && b.project !== b.agent)
        throw new HttpError(400, "Project and agent must match.");
      find(ctx, t.projects, projectId);
      authoringGrant(ctx, projectId);
      const result = tx(ctx, () => {
        const action = resolveActionForSave(ctx, projectId, b.name, b.action);
        return {
          action: action.id,
          version: serializeVersion(versionForSave(ctx, action, b)),
        };
      });
      return json(result, 201);
    }
    if (method === "GET" && !id) {
      scope(ctx, "catalog:read");
      const permitted = rows(ctx, t.actions).filter(
        (a) =>
          !isClient(ctx) ||
          ctx.token!.projects.includes(a.projectId) ||
          rows(ctx, t.actionVersions).some(
            (v) =>
              v.actionId === a.id && ctx.token!.actionVersions.includes(v.id),
          ),
      );
      return json(page(permitted.map(serializeAction)));
    }
    if (!id && method === "POST") {
      const b = await body();
      const projectId = b.project ?? b.agent;
      if (b.project && b.agent && b.project !== b.agent)
        throw new HttpError(400, "Project and agent must match.");
      find(ctx, t.projects, projectId);
      scope(ctx, "actions:write");
      authoringGrant(ctx, projectId);
      return json(
        serializeAction(
          insert(ctx, t.actions, {
            projectId,
            name: text(b.name, "name"),
            description: optionalDescription(b.description),
            enabled: booleanValue(b.enabled, true),
          }),
        ),
        201,
      );
    }
    if (id) {
      const action = find(ctx, t.actions, id);
      if (method === "GET") {
        scope(ctx, "catalog:read");
        if (!sub) {
          if (
            isClient(ctx) &&
            ctx.token &&
            !ctx.token.projects.includes(action.projectId) &&
            !rows(ctx, t.actionVersions).some(
              (v) =>
                v.actionId === id && ctx.token!.actionVersions.includes(v.id),
            )
          )
            throw new HttpError(404, "Not found.");
          return json(serializeAction(action));
        }
        if (sub === "versions")
          return json(
            rows(ctx, t.actionVersions)
              .filter(
                (v) =>
                  v.actionId === id &&
                  (!isClient(ctx) ||
                    ctx.token!.projects.includes(action.projectId) ||
                    ctx.token!.actionVersions.includes(v.id)),
              )
              .sort((a, b) => b.number - a.number)
              .map(serializeVersion),
          );
        if (sub === "version") {
          const n = Number(
            new URL(ctx.request.url).searchParams.get("version"),
          );
          const version = actionVersion(ctx, id, n || undefined).version;
          authorizeVersion(ctx, action, version, !!n);
          return json(serializeVersion(version));
        }
        if (sub === "tests") {
          const q = new URL(ctx.request.url).searchParams;
          const n = Number(q.get("version"));
          if (!n) throw new HttpError(400, "Select a version.");
          const version = actionVersion(ctx, id, n).version;
          authorizeVersion(ctx, action, version, true);
          const list = rows(ctx, t.actionTestSuites)
            .filter((s) => s.versionId === version.id)
            .sort((a, b) => b.number - a.number);
          const selected = q.get("suite_revision")
            ? list.find((s) => s.number === Number(q.get("suite_revision")))
            : list[0];
          if (!selected)
            throw new HttpError(404, "No test suite saved for this version.");
          return json(suiteView(selected));
        }
      }
      if (method === "POST" && sub === "versions") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        return json(
          serializeVersion(tx(ctx, () => versionForSave(ctx, action, b))),
          201,
        );
      }
      if (method === "POST" && sub === "tests") {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        const version = actionVersion(ctx, id, b.version).version;
        const cases = validateCases(version, b.cases);
        const hash = digest(JSON.stringify(cases));
        return json(
          suiteView(
            tx(ctx, () => {
              const list = rows(ctx, t.actionTestSuites)
                .filter((s) => s.versionId === version.id)
                .sort((a, b) => b.number - a.number);
              if (list[0]?.digest === hash) return list[0];
              return insert(ctx, t.actionTestSuites, {
                versionId: version.id,
                number: (list[0]?.number ?? 0) + 1,
                cases,
                digest: hash,
              });
            }),
          ),
        );
      }
      if (method === "POST" && sub === "run-tests") {
        const b = await body();
        return json(
          serializeRun(
            ctx,
            createRun(ctx, {
              ...b,
              project: action.projectId,
              action: id,
              operation: "test",
            }),
          ),
          201,
        );
      }
      if ((method === "PATCH" || method === "PUT") && !sub) {
        scope(ctx, "actions:write");
        authoringGrant(ctx, action.projectId);
        const b = await body();
        if (b.project && b.project !== action.projectId)
          throw new HttpError(400, "Action cannot move projects.");
        return json(
          serializeAction(
            update(ctx, t.actions, id, {
              name: b.name === undefined ? action.name : text(b.name, "name"),
              description: optionalDescription(
                b.description,
                action.description,
              ),
              enabled: booleanValue(b.enabled, action.enabled),
            }),
          ),
        );
      }
    }
  }
  return null;
}

async function handleDocuments(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "documents") {
    browser(ctx);
    const view = (d: any) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      content: d.content,
    });
    if (method === "GET")
      return id
        ? json(view(find(ctx, t.documents, id)))
        : json(page(rows(ctx, t.documents).map(view)));
    if (method === "POST" && !id) {
      const b = await body();
      if (
        !["memory", "document"].includes(b.kind) ||
        typeof b.content !== "string" ||
        b.content.length > 200000 ||
        b.content.includes("\0")
      )
        throw new HttpError(400, "Invalid document.");
      return json(
        view(
          insert(ctx, t.documents, {
            kind: b.kind,
            title: text(b.title, "title", 200),
            content: b.content,
          }),
        ),
        201,
      );
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const d = find(ctx, t.documents, id);
      const b = await body();
      const kind = b.kind ?? d.kind,
        content = b.content ?? d.content;
      if (
        !["memory", "document"].includes(kind) ||
        typeof content !== "string" ||
        content.length > 200000 ||
        content.includes("\0")
      )
        throw new HttpError(400, "Invalid document.");
      return json(
        view(
          update(ctx, t.documents, id, {
            kind,
            title:
              b.title === undefined ? d.title : text(b.title, "title", 200),
            content,
          }),
        ),
      );
    }
    if (id && method === "DELETE") {
      find(ctx, t.documents, id);
      tx(ctx, () => {
        for (const p of rows(ctx, t.projects))
          update(ctx, t.projects, p.id, {
            readableDocuments: p.readableDocuments.filter(
              (x: string) => x !== id,
            ),
            writableDocuments: p.writableDocuments.filter(
              (x: string) => x !== id,
            ),
          });
        remove(ctx, t.documents, id);
      });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}

async function handleCredentials(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "credentials") {
    browser(ctx, method !== "GET");
    const view = (c: any) => ({ id: c.id, name: c.name, provider: c.provider });
    if (method === "GET")
      return id
        ? json(view(find(ctx, t.credentials, id)))
        : json(page(rows(ctx, t.credentials).map(view)));
    if (method === "POST" && !id) {
      const b = await body();
      if (
        !object(b.secret) ||
        !Object.keys(b.secret).length ||
        Buffer.byteLength(JSON.stringify(b.secret)) > 32000
      )
        throw new HttpError(400, "Supply a nonempty secret object under 32KB.");
      return json(
        view(
          insert(ctx, t.credentials, {
            name: text(b.name, "name"),
            provider: text(b.provider, "provider"),
            encryptedSecret: encrypt(ctx.store, JSON.stringify(b.secret)),
          }),
        ),
        201,
      );
    }
    if (id && (method === "PATCH" || method === "PUT")) {
      const old = find(ctx, t.credentials, id),
        b = await body();
      let encryptedSecret = old.encryptedSecret;
      if (b.secret !== undefined) {
        if (
          !object(b.secret) ||
          !Object.keys(b.secret).length ||
          Buffer.byteLength(JSON.stringify(b.secret)) > 32000
        )
          throw new HttpError(
            400,
            "Supply a nonempty secret object under 32KB.",
          );
        encryptedSecret = encrypt(ctx.store, JSON.stringify(b.secret));
      }
      return json(
        view(
          update(ctx, t.credentials, id, {
            name: b.name === undefined ? old.name : text(b.name, "name"),
            provider:
              b.provider === undefined
                ? old.provider
                : text(b.provider, "provider"),
            encryptedSecret,
          }),
        ),
      );
    }
    if (id && method === "DELETE") {
      find(ctx, t.credentials, id);
      if (rows(ctx, t.plugins).some((p) => p.credentialId === id))
        throw new HttpError(409, "Credential is used by a plugin.");
      remove(ctx, t.credentials, id);
      return new Response(null, { status: 204 });
    }
  }
  return null;
}

async function handleTokens(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "tokens") {
    browser(ctx, true);
    if (method === "GET")
      return id
        ? json(tokenView(find(ctx, t.accessTokens, id)))
        : json(page(rows(ctx, t.accessTokens).map(tokenView)));
    if (method === "POST" && !id) {
      const b = await body();
      const client = [
        "catalog:read",
        "code:execute",
        "actions:write",
        "actions:run",
        "actions:test",
        "runs:read",
        "runs:cancel",
      ];
      const legacy = ["read", "write", "approve"];
      if (
        !Array.isArray(b.scopes) ||
        !b.scopes.length ||
        !(
          b.scopes.every((s: any) => client.includes(s)) ||
          b.scopes.every((s: any) => legacy.includes(s))
        )
      )
        throw new HttpError(
          400,
          "Provide supported scopes from one scope family.",
        );
      if (
        !Array.isArray(b.projects ?? []) ||
        !Array.isArray(b.action_versions ?? [])
      )
        throw new HttpError(400, "Invalid grants.");
      for (const p of b.projects ?? []) find(ctx, t.projects, p);
      for (const v of b.action_versions ?? []) find(ctx, t.actionVersions, v);
      const token = randomSecret();
      const row = insert(ctx, t.accessTokens, {
        actorId: ctx.user!.id,
        name: text(b.name, "name"),
        digest: digest(token),
        scopes: b.scopes,
        projects: b.projects ?? [],
        actionVersions: b.action_versions ?? [],
        revoked: false,
        firstUsedAt: null,
        lastUsedAt: null,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        restRequestCount: 0,
        mcpRequestCount: 0,
        lastTransport: "",
        lastOutcome: "",
        lastStatusCode: null,
      });
      return json({ id: row.id, token }, 201);
    }
    if (id && method === "DELETE") {
      find(ctx, t.accessTokens, id);
      update(ctx, t.accessTokens, id, { revoked: true });
      return new Response(null, { status: 204 });
    }
  }
  return null;
}

async function handleTables(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (resource === "tables") {
    browser(ctx);
    if (!id && method === "GET")
      return json(page(rows(ctx, t.workspaceTables).map(standard)));
    if (!id && method === "POST") {
      browser(ctx, true);
      const b = await body();
      assertFields(b, ["name", "columns"]);
      return json(
        standard(
          insert(ctx, t.workspaceTables, {
            name: text(b.name, "name", 120),
            columns: validateColumns(b.columns),
            revision: 1,
          }),
        ),
        201,
      );
    }
    if (id) {
      const table = find(ctx, t.workspaceTables, id);
      if (!sub && method === "GET") return json(standard(table));
      if (!sub && (method === "PATCH" || method === "PUT")) {
        browser(ctx, true);
        const b = await body();
        assertFields(b, ["name", "columns", "revision"]);
        return json(
          standard(
            tx(ctx, () => {
              const current = find(ctx, t.workspaceTables, id);
              checkRevision(current, b.revision);
              const columns = validateColumns(b.columns ?? current.columns);
              for (const row of rows(ctx, t.tableRows).filter(
                (r) => r.tableId === id,
              ))
                validateValues(columns, row.values);
              return update(ctx, t.workspaceTables, id, {
                name:
                  b.name === undefined
                    ? current.name
                    : text(b.name, "name", 120),
                columns,
                revision: current.revision + 1,
              });
            }),
          ),
        );
      }
      if (!sub && method === "DELETE") {
        browser(ctx, true);
        const revision = Number(
          new URL(ctx.request.url).searchParams.get("revision"),
        );
        tx(ctx, () => {
          checkRevision(find(ctx, t.workspaceTables, id), revision);
          for (const row of rows(ctx, t.tableRows).filter(
            (r) => r.tableId === id,
          ))
            remove(ctx, t.tableRows, row.id);
          for (const p of rows(ctx, t.projects))
            update(ctx, t.projects, p.id, {
              readableTables: p.readableTables.filter((x: string) => x !== id),
              writableTables: p.writableTables.filter((x: string) => x !== id),
            });
          remove(ctx, t.workspaceTables, id);
        });
        return new Response(null, { status: 204 });
      }
      if (sub === "rows") {
        if (method === "GET") {
          const selected = rows(ctx, t.tableRows).filter(
            (r) => r.tableId === id,
          );
          if (subId) {
            const row = selected.find((r) => r.id === subId);
            if (!row) throw new HttpError(404, "Not found.");
            return json(rowView(row));
          }
          return json(page(selected.map(rowView)));
        }
        if (method === "POST" && !subId) {
          const b = await body();
          assertFields(b, ["table_revision", "values"]);
          return json(
            rowView(
              tx(ctx, () => {
                const current = find(ctx, t.workspaceTables, id);
                checkRevision(current, b.table_revision);
                validateValues(current.columns, b.values);
                return insert(ctx, t.tableRows, {
                  tableId: id,
                  values: b.values,
                  revision: 1,
                });
              }),
            ),
            201,
          );
        }
        if (subId && (method === "PATCH" || method === "PUT")) {
          const b = await body();
          assertFields(b, ["table_revision", "revision", "values"]);
          return json(
            rowView(
              tx(ctx, () => {
                const current = find(ctx, t.workspaceTables, id);
                checkRevision(current, b.table_revision);
                const row = find(ctx, t.tableRows, subId);
                if (row.tableId !== id) throw new HttpError(404, "Not found.");
                checkRevision(row, b.revision);
                validateValues(current.columns, b.values);
                return update(ctx, t.tableRows, subId, {
                  values: b.values,
                  revision: row.revision + 1,
                });
              }),
            ),
          );
        }
        if (subId && method === "DELETE") {
          const revision = Number(
            new URL(ctx.request.url).searchParams.get("revision"),
          );
          tx(ctx, () => {
            const row = find(ctx, t.tableRows, subId);
            if (row.tableId !== id) throw new HttpError(404, "Not found.");
            checkRevision(row, revision);
            remove(ctx, t.tableRows, subId);
          });
          return new Response(null, { status: 204 });
        }
      }
    }
  }
  return null;
}

async function handleOtherResources(
  ctx: AppContext,
  resource: string,
  id: string | undefined,
  sub: string | undefined,
  subId: string | undefined,
): Promise<Response | null> {
  const method = ctx.request.method;
  const body = async () => input(ctx.request);
  if (
    [
      "plugins",
      "approvals",
      "artifacts",
      "schedules",
      "webhooks",
      "conversations",
      "audit",
    ].includes(resource)
  ) {
    browser(
      ctx,
      resource === "audit" ||
        (method !== "GET" &&
          ["plugins", "webhooks", "approvals"].includes(resource)),
    );
    const table: any = (
      {
        plugins: t.plugins,
        approvals: t.approvals,
        artifacts: t.artifacts,
        schedules: t.schedules,
        webhooks: t.webhooks,
        conversations: t.conversations,
        audit: t.auditRecords,
      } as any
    )[resource];
    const view = (r: any): any => {
      if (resource === "plugins")
        return {
          id: r.id,
          agent: r.projectId,
          slug: r.slug,
          version: r.version,
          description: r.description,
          source: r.source,
          digest: r.digest,
          enabled: r.enabled,
          credential: r.credentialId,
          distribution: r.distribution,
          configuration: r.configuration,
          package_url: r.packageUrl,
          tools: r.releaseMetadata?.tools ?? null,
          display_name: r.releaseMetadata?.display_name ?? r.slug,
          icon_url: r.releaseMetadata?.marketplace?.icon_url ?? "",
        };
      if (resource === "approvals")
        return {
          id: r.id,
          run: r.runId,
          prompt: r.prompt,
          status: r.status,
          decided_by: r.decidedBy,
        };
      if (resource === "artifacts")
        return {
          id: r.id,
          run: r.runId,
          name: r.name,
          content: r.content,
          media_type: r.mediaType,
        };
      if (resource === "schedules")
        return {
          id: r.id,
          action: r.actionId,
          cron: r.cron,
          inputs: r.inputs,
          enabled: r.enabled,
          next_run_at: r.nextRunAt,
        };
      if (resource === "conversations")
        return {
          id: r.id,
          agent: r.projectId,
          title: r.title,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        };
      if (resource === "audit") {
        const member =
          r.actorId &&
          ctx.store.db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, workspace(ctx)),
                eq(memberships.userId, r.actorId),
              ),
            )
            .get();
        const actor =
          member &&
          ctx.store.db
            .select()
            .from(users)
            .where(eq(users.id, r.actorId))
            .get();
        return {
          id: r.id,
          actor_id: member ? r.actorId : null,
          actor_label: actor
            ? [actor.firstName, actor.lastName].filter(Boolean).join(" ") ||
              actor.username
            : r.actorId
              ? "Former workspace member"
              : "System or deleted account",
          kind: r.action,
          object_id: r.resource,
          created_at: r.createdAt,
        };
      }
      const version = find(ctx, t.actionVersions, r.actionVersionId),
        action = find(ctx, t.actions, version.actionId);
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
        deliveries: rows(ctx, t.webhookDeliveries)
          .filter((d) => d.webhookId === r.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
          .map((d) => ({
            id: d.id,
            delivery_id: d.deliveryId,
            received_at: d.createdAt,
            outcome: d.outcome,
            run: d.runId,
            run_status: d.runId ? find(ctx, t.runs, d.runId).status : null,
          })),
      };
    };
    if (resource === "plugins" && id === "catalog" && method === "GET")
      return json(await catalogEntries());
    if (resource === "plugins" && id === "marketplace" && method === "GET")
      return json(await marketplaceEntries());
    if (resource === "plugins" && method === "POST" && !id) {
      const b = await body();
      const projectId = text(b.agent, "project");
      find(ctx, t.projects, projectId);
      const slug = text(b.slug, "slug", 50);
      if (
        !/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(slug) ||
        rows(ctx, t.plugins).some(
          (p) => p.projectId === projectId && p.slug === slug,
        )
      )
        throw new HttpError(400, "Invalid or already installed plugin.");
      const version = text(b.version, "version");
      const distribution = b.distribution ?? "inline";
      let source = "",
        metadata: any = {},
        packageUrl = "",
        hash = "";
      if (distribution === "inline") {
        source = sourceText(b.source);
        hash = digest(source);
      } else if (distribution === "external") {
        metadata = await catalogRelease(slug, version);
        packageUrl = metadata.package_url;
        hash = metadata.digest;
        validateContract(metadata.configuration_schema, b.configuration ?? {});
      } else throw new HttpError(400, "Invalid distribution.");
      if (b.credential) {
        const credential = find(ctx, t.credentials, b.credential);
        if (
          distribution === "external" &&
          credential.provider !== metadata.auth?.provider
        )
          throw new HttpError(400, "Credential provider does not match.");
      }
      return json(
        view(
          insert(ctx, t.plugins, {
            projectId,
            slug,
            version,
            description:
              distribution === "external"
                ? metadata.description
                : optionalDescription(b.description),
            source,
            digest: hash,
            enabled: booleanValue(b.enabled, true),
            credentialId: b.credential ?? null,
            configuration: jsonValue(b.configuration ?? {}, "Configuration"),
            releaseMetadata: metadata,
            packageUrl,
            distribution,
          }),
        ),
        201,
      );
    }
    if (
      resource === "plugins" &&
      id &&
      (method === "PATCH" || method === "PUT")
    ) {
      const p = find(ctx, t.plugins, id),
        b = await body();
      if (b.agent && b.agent !== p.projectId)
        throw new HttpError(400, "Reinstall plugins to move them.");
      if (b.distribution && b.distribution !== p.distribution)
        throw new HttpError(
          400,
          "Remove the plugin before changing its distribution.",
        );
      let metadata = p.releaseMetadata,
        source = p.source,
        hash = p.digest,
        packageUrl = p.packageUrl,
        description = optionalDescription(b.description, p.description);
      const version = b.version ?? p.version;
      if (p.distribution === "external") {
        if (b.source)
          throw new HttpError(
            400,
            "External plugin source is managed by its release.",
          );
        if (version !== p.version || b.refresh_bundle)
          metadata = await catalogRelease(p.slug, version);
        hash = metadata.digest;
        packageUrl = metadata.package_url;
        description = metadata.description;
        validateContract(
          metadata.configuration_schema,
          b.configuration ?? p.configuration,
        );
      } else if (b.source !== undefined) {
        source = sourceText(b.source);
        if (source !== p.source && version === p.version)
          throw new HttpError(400, "Changed source requires a new version.");
        hash = digest(source);
      }
      if (b.credential) {
        const c = find(ctx, t.credentials, b.credential);
        if (
          p.distribution === "external" &&
          c.provider !== metadata.auth?.provider
        )
          throw new HttpError(400, "Credential provider does not match.");
      }
      return json(
        view(
          update(ctx, t.plugins, id, {
            version: text(version, "version"),
            description,
            source,
            digest: hash,
            packageUrl,
            releaseMetadata: metadata,
            enabled: booleanValue(b.enabled, p.enabled),
            credentialId:
              b.credential === undefined ? p.credentialId : b.credential,
            configuration: jsonValue(
              b.configuration ?? p.configuration,
              "Configuration",
            ),
          }),
        ),
      );
    }
    if (resource === "plugins" && id && method === "DELETE") {
      find(ctx, t.plugins, id);
      remove(ctx, t.plugins, id);
      return new Response(null, { status: 204 });
    }
    if (resource === "schedules" && method === "POST" && !id) {
      const b = await body();
      const action = find(ctx, t.actions, b.action);
      if (!action.enabled) throw new HttpError(400, "Action is disabled.");
      const version = actionVersion(ctx, action.id).version;
      const inputs = jsonValue(b.inputs ?? {}, "Inputs");
      validateContract(version.inputSchema, inputs);
      return json(
        view(
          insert(ctx, t.schedules, {
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
      const old = find(ctx, t.schedules, id),
        b = await body();
      const action = find(ctx, t.actions, b.action ?? old.actionId),
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
          update(ctx, t.schedules, id, {
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
      find(ctx, t.schedules, id);
      remove(ctx, t.schedules, id);
      return new Response(null, { status: 204 });
    }
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
      const hook = insert(ctx, t.webhooks, {
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
    if (
      resource === "webhooks" &&
      id &&
      sub === "rotate" &&
      method === "POST"
    ) {
      find(ctx, t.webhooks, id);
      const secret = randomSecret(),
        hook = update(ctx, t.webhooks, id, {
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
      const old = find(ctx, t.webhooks, id),
        b = await body();
      if (b.action !== undefined)
        throw new HttpError(
          400,
          "Register a new webhook to change its action.",
        );
      return json(
        view(
          update(ctx, t.webhooks, id, {
            name: b.name === undefined ? old.name : text(b.name, "name"),
            enabled: booleanValue(b.enabled, old.enabled),
          }),
        ),
      );
    }
    if (resource === "audit" && method === "GET" && !id) {
      const query = new URL(ctx.request.url).searchParams;
      const actor = query.get("actor"),
        kind = query.get("kind"),
        objectId = query.get("object_id"),
        since = query.get("since"),
        before = query.get("before");
      if (
        (actor && (!/^\d+$/.test(actor) || Number(actor) < 1)) ||
        (since && Number.isNaN(Date.parse(since))) ||
        (before && Number.isNaN(Date.parse(before))) ||
        (since && before && Date.parse(since) >= Date.parse(before))
      )
        throw new HttpError(400, "Invalid audit filters.");
      return json(
        page(
          rows(ctx, table)
            .filter(
              (row) =>
                (!actor || row.actorId === Number(actor)) &&
                (!kind || row.action === kind) &&
                (!objectId || row.resource === objectId) &&
                (!since || Date.parse(row.createdAt) >= Date.parse(since)) &&
                (!before || Date.parse(row.createdAt) < Date.parse(before)),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(view),
        ),
      );
    }
    if (method === "GET" && !id) return json(page(rows(ctx, table).map(view)));
    if (method === "GET" && id && !sub) return json(view(find(ctx, table, id)));
    if (
      resource === "approvals" &&
      id &&
      sub === "decide" &&
      method === "POST"
    ) {
      const b = await body();
      if (!["approved", "denied"].includes(b.decision))
        throw new HttpError(400, "Invalid decision.");
      return json(
        view(
          tx(ctx, () => {
            const approval = find(ctx, t.approvals, id);
            if (
              approval.status !== "pending" ||
              ["succeeded", "failed", "cancelled", "interrupted"].includes(
                find(ctx, t.runs, approval.runId).status,
              )
            )
              throw new HttpError(409, "Approval is no longer actionable.");
            return update(ctx, t.approvals, id, {
              status: b.decision,
              decidedBy: ctx.user!.id,
            });
          }),
        ),
      );
    }
  }
  return null;
}

export async function handleDomain(ctx: AppContext): Promise<Response | null> {
  const oauth = await handleOAuth(ctx);
  if (oauth) return oauth;
  const path = new URL(ctx.request.url).pathname;
  const match = path.match(
    /^\/api\/v1\/(projects|agents|actions|runs|credentials|documents|tables|tokens|plugins|approvals|artifacts|schedules|webhooks|conversations|audit)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?\/?$/,
  );
  if (!match) return null;
  const [, matchedResource, id, sub, subId] = match;
  const resource = matchedResource!;
  const method = ctx.request.method;
  workspace(ctx);
  const result =
    (await handleExecutorRoute(ctx, resource, id, sub, subId)) ??
    (await handleProjects(ctx, resource, id, sub, subId)) ??
    (await handleRuns(ctx, resource, id, sub, subId)) ??
    (await handleActions(ctx, resource, id, sub, subId)) ??
    (await handleDocuments(ctx, resource, id, sub, subId)) ??
    (await handleCredentials(ctx, resource, id, sub, subId)) ??
    (await handleTokens(ctx, resource, id, sub, subId)) ??
    (await handleTables(ctx, resource, id, sub, subId)) ??
    (await handleOtherResources(ctx, resource, id, sub, subId));
  if (result) return result;

  throw new HttpError(405, "Operation is not implemented.");
}

export async function handleWebhookIngress(
  ctx: AppContext,
): Promise<Response | null> {
  const match = new URL(ctx.request.url).pathname.match(
    /^\/api\/v1\/webhook-ingress\/([^/]+)\/$/,
  );
  if (!match) return null;
  if (ctx.request.method !== "POST")
    throw new HttpError(405, "Method not allowed.");
  const hook = ctx.store.db
    .select()
    .from(t.webhooks)
    .where(eq(t.webhooks.id, match[1]!))
    .get();
  if (!hook || !ctx.workspace || hook.workspaceId !== ctx.workspace.id)
    throw new HttpError(404, "Webhook not found.");
  const secret = ctx.request.headers.get("x-webhook-secret") ?? "";
  const expected = Buffer.from(hook.secretHash, "hex"),
    actual = Buffer.from(digest(secret), "hex");
  if (
    secret.length > 256 ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    throw new HttpError(403, "Webhook authentication failed.");
  const delivery = ctx.request.headers.get("x-webhook-delivery") ?? "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(delivery))
    throw new HttpError(400, "Invalid delivery id.");
  if (
    (ctx.request.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase() !== "application/json"
  )
    throw new HttpError(415, "JSON required.");
  const bytes = await ctx.request.arrayBuffer();
  if (bytes.byteLength > 200000) throw new HttpError(413, "Payload too large.");
  let payload: any;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new HttpError(400, "Invalid payload.");
  }
  if (!object(payload) || Object.keys(payload).join() !== "inputs")
    throw new HttpError(400, "Invalid payload.");
  jsonValue(payload.inputs, "Inputs");
  const actor = ctx.store.db
    .select()
    .from(users)
    .where(eq(users.id, hook.actorId))
    .get();
  const member = ctx.store.db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, hook.actorId),
        eq(memberships.workspaceId, hook.workspaceId),
      ),
    )
    .get();
  if (!hook.enabled || !actor || !member)
    throw new HttpError(403, "Webhook is unavailable.");
  const actorCtx: AppContext = {
    ...ctx,
    user: actor,
    role: member.role,
    token: null,
  };
  const version = find(actorCtx, t.actionVersions, hook.actionVersionId),
    action = find(actorCtx, t.actions, version.actionId);
  const hash = digest(canonicalJson(payload));
  return tx(actorCtx, () => {
    const current = find(actorCtx, t.webhooks, hook.id);
    if (!current.enabled || current.secretHash !== hook.secretHash)
      throw new HttpError(403, "Webhook is unavailable.");
    const old = rows(actorCtx, t.webhookDeliveries).find(
      (d) => d.webhookId === hook.id && d.deliveryId === delivery,
    );
    if (old) {
      if (old.payloadHash !== hash)
        throw new HttpError(
          409,
          "Delivery id was already used with a different payload.",
        );
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
      inputs: payload.inputs,
      idempotency_key: `webhook:${hook.id}:${delivery}`,
    });
    update(actorCtx, t.runs, run.id, {
      origin: "webhook",
      originReference: hook.id,
    });
    insert(actorCtx, t.webhookDeliveries, {
      webhookId: hook.id,
      deliveryId: delivery,
      payloadHash: hash,
      outcome: "accepted",
      runId: run.id,
    });
    update(actorCtx, t.webhooks, hook.id, {
      lastReceivedAt: now(),
      lastAcceptedAt: now(),
    });
    return json({ run: run.id, outcome: "accepted", duplicate: false }, 202);
  });
}
