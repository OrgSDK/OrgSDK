export function tokenView(row: any) {
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
