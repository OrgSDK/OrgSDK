import type { actions, actionVersions, actionTestSuites } from "../db/schema";
export function serializeAction(row: typeof actions.$inferSelect) {
  return {
    id: row.id,
    project: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
  };
}

export function serializeVersion(row: typeof actionVersions.$inferSelect) {
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

export function suiteView(suite: typeof actionTestSuites.$inferSelect) {
  return {
    id: suite.id,
    version: suite.versionId,
    revision: suite.number,
    digest: suite.digest,
    cases: suite.cases,
    created_at: suite.createdAt,
  };
}
