import type {
  JsonObject,
  JsonValue,
  TableColumn,
  PluginMetadata,
} from "./types";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("domain_projects", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  readableTables: text("readable_tables", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  writableTables: text("writable_tables", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  readableDocuments: text("readable_documents", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  writableDocuments: text("writable_documents", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const executors = sqliteTable("domain_executors", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  pool: text("pool").notNull(),
  tokenHash: text("token_hash").notNull(),
  registrationNonce: text("registration_nonce").notNull(),
  locallyManaged: integer("locally_managed", { mode: "boolean" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  protocolVersion: integer("protocol_version").notNull(),
  capabilities: text("capabilities", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceSettings = sqliteTable("domain_workspace_settings", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  executionPool: text("execution_pool").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  maxConcurrentRuns: integer("max_concurrent_runs").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const actions = sqliteTable("domain_actions", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const actionVersions = sqliteTable("domain_action_versions", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  actionId: text("action_id").notNull(),
  number: integer("number").notNull(),
  source: text("source").notNull(),
  inputSchema: text("input_schema", { mode: "json" })
    .notNull()
    .$type<JsonObject>(),
  outputSchema: text("output_schema", { mode: "json" })
    .notNull()
    .$type<JsonObject>(),
  validationMode: text("validation_mode").notNull(),
  sdkContract: text("sdk_contract", { mode: "json" })
    .notNull()
    .$type<JsonObject>(),
  promotedFrom: text("promoted_from"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const actionTestSuites = sqliteTable("domain_action_test_suites", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  versionId: text("version_id").notNull(),
  number: integer("number").notNull(),
  cases: text("cases", { mode: "json" }).notNull().$type<JsonObject[]>(),
  digest: text("digest").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const plugins = sqliteTable("domain_plugins", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
  slug: text("slug").notNull(),
  version: text("version").notNull(),
  description: text("description").notNull(),
  source: text("source").notNull(),
  digest: text("digest").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  credentialId: text("credential_id"),
  configuration: text("configuration", { mode: "json" })
    .notNull()
    .$type<JsonObject>(),
  releaseMetadata: text("release_metadata", { mode: "json" })
    .notNull()
    .$type<PluginMetadata>(),
  packageUrl: text("package_url").notNull(),
  distribution: text("distribution").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const credentials = sqliteTable("domain_credentials", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  encryptedSecret: text("encrypted_secret").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const documents = sqliteTable("domain_documents", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceTables = sqliteTable("domain_workspace_tables", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  name: text("name").notNull(),
  columns: text("columns", { mode: "json" }).notNull().$type<TableColumn[]>(),
  revision: integer("revision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tableRows = sqliteTable("domain_table_rows", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  tableId: text("table_id").notNull(),
  values: text("values", { mode: "json" }).notNull().$type<JsonObject>(),
  revision: integer("revision").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accessTokens = sqliteTable("domain_access_tokens", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  actorId: integer("actor_id").notNull(),
  name: text("name").notNull(),
  digest: text("digest").notNull(),
  scopes: text("scopes", { mode: "json" }).notNull().$type<string[]>(),
  projects: text("projects", { mode: "json" }).notNull().$type<string[]>(),
  actionVersions: text("action_versions", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  revoked: integer("revoked", { mode: "boolean" }).notNull(),
  firstUsedAt: text("first_used_at"),
  lastUsedAt: text("last_used_at"),
  requestCount: integer("request_count").notNull(),
  successCount: integer("success_count").notNull(),
  errorCount: integer("error_count").notNull(),
  restRequestCount: integer("rest_request_count").notNull(),
  mcpRequestCount: integer("mcp_request_count").notNull(),
  lastTransport: text("last_transport").notNull(),
  lastOutcome: text("last_outcome").notNull(),
  lastStatusCode: integer("last_status_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable("domain_runs", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
  actorId: integer("actor_id").notNull(),
  tokenId: text("token_id"),
  actionVersionId: text("action_version_id"),
  operation: text("operation").notNull(),
  origin: text("origin").notNull(),
  originReference: text("origin_reference").notNull(),
  inputs: text("inputs", { mode: "json" }).notNull().$type<JsonObject>(),
  snapshot: text("snapshot", { mode: "json" }).notNull().$type<JsonObject>(),
  status: text("status").notNull(),
  output: text("output", { mode: "json" }).notNull().$type<JsonValue>(),
  error: text("error").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  idempotencyNamespace: text("idempotency_namespace").notNull(),
  retryOf: text("retry_of"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull(),
  executorId: text("executor_id"),
  leaseExpiresAt: text("lease_expires_at"),
  deadline: text("deadline"),
  capabilityHash: text("capability_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runEvents = sqliteTable("domain_run_events", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  data: text("data", { mode: "json" }).notNull().$type<JsonObject>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const approvals = sqliteTable("domain_approvals", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  runId: text("run_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull(),
  decidedBy: integer("decided_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const artifacts = sqliteTable("domain_artifacts", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  runId: text("run_id").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  mediaType: text("media_type").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schedules = sqliteTable("domain_schedules", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  actionId: text("action_id").notNull(),
  actorId: integer("actor_id").notNull(),
  cron: text("cron").notNull(),
  inputs: text("inputs", { mode: "json" }).notNull().$type<JsonObject>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  nextRunAt: text("next_run_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhooks = sqliteTable("domain_webhooks", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  name: text("name").notNull(),
  actionVersionId: text("action_version_id").notNull(),
  actorId: integer("actor_id").notNull(),
  secretHash: text("secret_hash").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  rotatedAt: text("rotated_at").notNull(),
  lastReceivedAt: text("last_received_at"),
  lastAcceptedAt: text("last_accepted_at"),
  lastRejection: text("last_rejection").notNull(),
  lastRejectedAt: text("last_rejected_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const webhookDeliveries = sqliteTable("domain_webhook_deliveries", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  webhookId: text("webhook_id").notNull(),
  deliveryId: text("delivery_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  outcome: text("outcome").notNull(),
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditRecords = sqliteTable("domain_audit_records", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  actorId: integer("actor_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  data: text("data", { mode: "json" }).notNull().$type<JsonObject>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversations = sqliteTable("domain_conversations", {
  id: text("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const domainDDL = `
CREATE TABLE IF NOT EXISTS domain_projects ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "name" text not null, "enabled" integer not null default 1, "readable_tables" text not null default '[]', "writable_tables" text not null default '[]', "readable_documents" text not null default '[]', "writable_documents" text not null default '[]', "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_executors ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "project_id" text not null unique references domain_projects(id) on delete CASCADE, "name" text not null unique, "pool" text not null default 'shared', "token_hash" text not null unique, "registration_nonce" text not null, "locally_managed" integer not null default 0, "enabled" integer not null default 1, "protocol_version" integer not null default 1, "capabilities" text not null default '[]', "last_seen_at" text, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_workspace_settings ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "execution_pool" text not null default 'shared', "enabled" integer not null default 1, "max_concurrent_runs" integer not null default 4, "created_at" text not null, "updated_at" text not null, unique(workspace_id));
CREATE TABLE IF NOT EXISTS domain_actions ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "project_id" text not null references domain_projects(id) on delete CASCADE, "name" text not null, "description" text not null default '', "enabled" integer not null default 1, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_action_versions ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "action_id" text not null references domain_actions(id) on delete CASCADE, "number" integer not null, "source" text not null, "input_schema" text not null default '{}', "output_schema" text not null default '{}', "validation_mode" text not null default 'legacy', "sdk_contract" text not null default '{}', "promoted_from" text  references domain_runs(id) on delete RESTRICT, "created_at" text not null, "updated_at" text not null, unique(action_id, number));
CREATE TABLE IF NOT EXISTS domain_action_test_suites ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "version_id" text not null references domain_action_versions(id) on delete CASCADE, "number" integer not null, "cases" text not null, "digest" text not null, "created_at" text not null, "updated_at" text not null, unique(version_id, number));
CREATE TABLE IF NOT EXISTS domain_plugins ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "project_id" text not null references domain_projects(id) on delete CASCADE, "slug" text not null, "version" text not null, "description" text not null default '', "source" text not null default '', "digest" text not null, "enabled" integer not null default 1, "credential_id" text  references domain_credentials(id) on delete SET NULL, "configuration" text not null default '{}', "release_metadata" text not null default '{}', "package_url" text not null default '', "distribution" text not null default 'inline', "created_at" text not null, "updated_at" text not null, unique(project_id, slug));
CREATE TABLE IF NOT EXISTS domain_credentials ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "name" text not null, "provider" text not null, "encrypted_secret" text not null, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_documents ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "kind" text not null, "title" text not null, "content" text not null default '', "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_workspace_tables ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "name" text not null, "columns" text not null, "revision" integer not null default 1, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_table_rows ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "table_id" text not null references domain_workspace_tables(id) on delete CASCADE, "values" text not null, "revision" integer not null default 1, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_access_tokens ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "actor_id" integer not null references users(id) on delete RESTRICT, "name" text not null, "digest" text not null unique, "scopes" text not null, "projects" text not null default '[]', "action_versions" text not null default '[]', "revoked" integer not null default 0, "first_used_at" text, "last_used_at" text, "request_count" integer not null default 0, "success_count" integer not null default 0, "error_count" integer not null default 0, "rest_request_count" integer not null default 0, "mcp_request_count" integer not null default 0, "last_transport" text not null default '', "last_outcome" text not null default '', "last_status_code" integer, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_runs ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "project_id" text not null references domain_projects(id) on delete RESTRICT, "actor_id" integer not null references users(id) on delete RESTRICT, "token_id" text  references domain_access_tokens(id) on delete RESTRICT, "action_version_id" text  references domain_action_versions(id) on delete RESTRICT, "operation" text not null, "origin" text not null default 'browser', "origin_reference" text not null default '', "inputs" text not null default '{}', "snapshot" text not null default '{}', "status" text not null default 'queued', "output" text not null default '{}', "error" text not null default '', "idempotency_key" text not null, "idempotency_namespace" text not null default '', "retry_of" text  references domain_runs(id) on delete SET NULL, "cancel_requested" integer not null default 0, "executor_id" text  references domain_executors(id) on delete SET NULL, "lease_expires_at" text, "deadline" text, "capability_hash" text not null default '', "created_at" text not null, "updated_at" text not null, check(status in ('queued','running','waiting_approval','succeeded','failed','cancelled','interrupted')), unique(workspace_id, idempotency_namespace, idempotency_key));
CREATE TABLE IF NOT EXISTS domain_run_events ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "run_id" text not null references domain_runs(id) on delete CASCADE, "sequence" integer not null, "kind" text not null, "data" text not null default '{}', "created_at" text not null, "updated_at" text not null, unique(run_id, sequence));
CREATE TABLE IF NOT EXISTS domain_approvals ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "run_id" text not null references domain_runs(id) on delete CASCADE, "prompt" text not null, "status" text not null default 'pending', "decided_by" integer  references users(id) on delete RESTRICT, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_artifacts ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "run_id" text not null references domain_runs(id) on delete CASCADE, "name" text not null, "content" text not null, "media_type" text not null default 'text/plain', "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_schedules ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "action_id" text not null references domain_actions(id) on delete CASCADE, "actor_id" integer not null references users(id) on delete RESTRICT, "cron" text not null, "inputs" text not null default '{}', "enabled" integer not null default 1, "next_run_at" text not null, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_webhooks ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "name" text not null, "action_version_id" text not null references domain_action_versions(id) on delete RESTRICT, "actor_id" integer not null references users(id) on delete RESTRICT, "secret_hash" text not null, "enabled" integer not null default 1, "rotated_at" text not null, "last_received_at" text, "last_accepted_at" text, "last_rejection" text not null default '', "last_rejected_at" text, "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_webhook_deliveries ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "webhook_id" text not null references domain_webhooks(id) on delete CASCADE, "delivery_id" text not null, "payload_hash" text not null, "outcome" text not null, "run_id" text  references domain_runs(id) on delete SET NULL, "created_at" text not null, "updated_at" text not null, unique(webhook_id, delivery_id));
CREATE TABLE IF NOT EXISTS domain_audit_records ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "actor_id" integer  references users(id) on delete SET NULL, "action" text not null, "resource" text not null, "data" text not null default '{}', "created_at" text not null, "updated_at" text not null);
CREATE TABLE IF NOT EXISTS domain_conversations ("id" text primary key, "workspace_id" integer not null references workspaces(id) on delete CASCADE, "project_id" text not null references domain_projects(id) on delete RESTRICT, "title" text not null default 'New conversation', "created_at" text not null, "updated_at" text not null);
`;
