import type { AppContext } from "../http/context";
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
