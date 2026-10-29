# Retained OrgSDK engine

Source: OrgSDK/OrgSDK, commit 6cd23db588985072bddf8b9f4f64d512712b3494

This attribution is included in the executor npm package alongside the retained
source. It records origin and modifications; it does not grant a new license or
replace any applicable upstream copyright and permission notices.

Sandbox, CPU budgeting, TypeScript validation/transpilation, function proxies, secret redaction, plugin namespacing, plugin types and retry utilities are retained from packages/daemon/src. Local changes replace repository-specific logging/constants and the database AgentRow type. Product orchestration uses scoped OrgSDK HTTP APIs rather than the old AllStores/Postgres boot path. Original tests are retained where their dependencies belong to this extracted engine.

The eleven vendored product plugins and generated bundled catalog have been removed. Plugins are independently released, self-contained ESM artifacts, verified against the snapshot SHA256 before execution. No external plugin source is included in this package. The retained factory-context and safeFunctions adapter derives from the previously integrated OrgSDK plugin interface.

The project/action refactor removes the local OpenAI reasoning loop and chat-stream collector. The retained sandbox, plugin adapters, process isolation and execution tests continue to support code/actions and isolated validation/tests. Historical chat/delegation jobs fail explicitly; their removal does not replace the original vendor provenance.
