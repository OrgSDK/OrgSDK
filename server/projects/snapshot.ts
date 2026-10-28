import { and, eq } from "drizzle-orm";
import * as resourceTables from "../db/schema";
import type { AppContext } from "../http/context";
import { pluginsRepository } from "../repositories/plugins";
import { projectsRepository } from "../repositories/projects";
import { object } from "../shared/contracts";
import { digest } from "../shared/security";
import { pluginNamespace } from "./plugin-namespace";
export function projectSnapshot(
  ctx: AppContext,
  projectId: string,
  operation = "code",
) {
  const project = projectsRepository(ctx).find(projectId);
  const restricted = operation === "validate" || operation === "test";
  const resources = {
    tables: { read: project.readableTables, write: project.writableTables },
    documents: {
      read: project.readableDocuments,
      write: project.writableDocuments,
    },
  };
  const installed = pluginsRepository(ctx)
    .list(
      and(
        eq(resourceTables.plugins.projectId, projectId),
        eq(resourceTables.plugins.enabled, true),
      ),
    )
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
