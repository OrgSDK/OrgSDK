export function serializeAction(row: any) {
  return {
    id: row.id,
    agent: row.projectId,
    project: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
  };
}

export function serializeVersion(row: any) {
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

export function suiteView(s: any) {
  return {
    id: s.id,
    version: s.versionId,
    revision: s.number,
    digest: s.digest,
    cases: s.cases,
    created_at: s.createdAt,
  };
}
