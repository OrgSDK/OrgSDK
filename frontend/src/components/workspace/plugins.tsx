"use client";
import dynamic from "next/dynamic";
import { PluginMarketplace } from "./plugin-marketplace";
import { PluginConnection } from "./plugin-connection";
import { PluginIcon } from "./plugin-icon";
import { PluginCapabilities } from "./plugin-capabilities";
import { pinnedPluginTools, pluginIconUrl } from "../../lib/plugin-tools";
import { MarkdownContent } from "../markdown-content";
import { Package, Power } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result, errorMessage, requireSuccess } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadCredentials, loadPlugins } from "../../api/workspace-queries";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { useDiscardConfirmation } from "./discard-dialog";
import type { components } from "../../api/schema";
import { useWorkspace } from "./workspace-context";
import { ResourceState } from "./resource-state";
import { WorkspaceLink } from "./workspace-link";
const Editor = dynamic(
  async () => {
    const editorModule = await import("./action-editor");
    editorModule.configureMonaco();
    return editorModule.default;
  },
  { ssr: false },
);
const initialSource =
  'export const safeFunctions = [{\n  name: "greet",\n  handler: (name: string) => `Hello, ${name}!`\n}];';
function parseConfig(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}
async function loadPluginData(signal: AbortSignal): Promise<{
  plugins: Awaited<ReturnType<typeof loadPlugins>>;
  credentials: Awaited<ReturnType<typeof loadCredentials>>;
}> {
  const [plugins, credentials] = await Promise.all([
    loadPlugins(signal),
    loadCredentials(signal),
  ]);
  return { plugins, credentials };
}
async function loadCatalog(
  signal: AbortSignal,
): Promise<components["schemas"]["CatalogEntry"][]> {
  return result(await api.GET("/api/v1/plugins/catalog/", { signal }));
}
export function Plugins({
  canManage,
  onDirtyChange,
}: {
  canManage: boolean;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const query = useWorkspaceQuery(loadPluginData);
  const catalogQuery = useWorkspaceQuery(loadCatalog);
  const latestReleases = (catalogQuery.data ?? []).filter(
    (entry, index, entries) =>
      entries.findIndex((item) => item.slug === entry.slug) === index,
  );
  const { selected: projectId, agents } = useWorkspace();
  const project = agents.find((item) => item.id === projectId);
  const plugins = (query.data?.plugins ?? []).filter(
    (item) => item.agent === projectId,
  );
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingReleases = latestReleases.filter((entry) => {
    const text = [
      entry.display_name,
      entry.description,
      entry.category,
      ...pinnedPluginTools(entry.tools).tools.map(
        (tool) => `${tool.name} ${tool.description}`,
      ),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const [slug, setSlug] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState(initialSource);
  const [credential, setCredential] = useState("");
  const [config, setConfig] = useState("{}");
  const installed = plugins.find((item) => item.id === selected);
  const isExternal = installed?.distribution === "external";
  const release = catalogQuery.data?.find(
    (item) => item.slug === installed?.slug,
  );
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currentValues = JSON.stringify({
    slug,
    version,
    description,
    source,
    credential,
    configuration: config,
  });
  const [savedValues, setSavedValues] = useState(
    JSON.stringify({
      slug: "",
      version: "1.0.0",
      description: "",
      source: initialSource,
      credential: "",
      configuration: "{}",
    }),
  );
  const isDirty = currentValues !== savedValues;
  const canDiscard = useDiscardConfirmation();
  useUnsavedChanges(isDirty, onDirtyChange);
  if (!project)
    return (
      <section className="panel space-y-4">
        <h2>Project plugins</h2>
        <p>Create a project before installing and configuring its tools.</p>
        <WorkspaceLink href="/projects/?new=1">Create project</WorkspaceLink>
      </section>
    );
  const applyPlugin = (plugin?: components["schemas"]["Plugin"]): void => {
    const values = {
      slug: plugin?.slug ?? "",
      version: plugin?.version ?? "1.0.0",
      description: plugin?.description ?? "",
      source: plugin?.source ?? initialSource,
      credential: plugin?.credential ?? "",
      configuration: JSON.stringify(plugin?.configuration ?? {}, null, 2),
    };
    setSelected(plugin?.id ?? "");
    setSlug(values.slug);
    setVersion(values.version);
    setDescription(values.description);
    setSource(values.source);
    setCredential(values.credential);
    setConfig(values.configuration);
    setSavedValues(JSON.stringify(values));
  };
  const selectPlugin = async (
    plugin?: components["schemas"]["Plugin"],
  ): Promise<void> => {
    if (isDirty && !(await canDiscard())) return;
    applyPlugin(plugin);
  };
  const perform = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      await query.refresh();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <h2>Plugin marketplace</h2>
        <p>
          Install optional tools for {project.name} from the external
          marketplace. This project owns its plugin configuration and
          credentials.
        </p>
        <p className="small mt-3">
          Project: <strong>{project.name}</strong>
        </p>
        <ResourceState {...catalogQuery} />
        <label className="my-4 block">
          Find plugins or capabilities
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search plugins, functions or descriptions"
          />
        </label>
        {!catalogQuery.isLoading &&
        !catalogQuery.error &&
        latestReleases.length > 0 &&
        matchingReleases.length === 0 ? (
          <p>No plugins match this search.</p>
        ) : null}
        {!catalogQuery.isLoading &&
        !catalogQuery.error &&
        catalogQuery.data?.length === 0 ? (
          <p>
            No external releases are available from the configured marketplace.
            Your projects can run without plugins.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {matchingReleases.map((entry) => {
            const existing = plugins.find((item) => item.slug === entry.slug);
            return (
              <article
                key={entry.slug}
                className="min-w-0 rounded-lg border p-4"
                aria-label={entry.display_name}
              >
                <div className="flex items-center gap-3">
                  <PluginIcon url={pluginIconUrl(entry.marketplace)} />
                  <h3>{entry.display_name}</h3>
                </div>
                <p className="small">
                  {entry.category} · v{entry.version}
                </p>
                <p>{entry.description}</p>
                <PluginCapabilities slug={entry.slug} metadata={entry.tools} />
                <p className="small">
                  {entry.package_url
                    ? "Downloadable package. The runner installs this pinned release for the selected project."
                    : "Local package. Install this package on the selected project’s runner first using the executor CLI with --file. Saving its configuration here does not install the package."}
                </p>
                {canManage &&
                existing?.distribution === "external" &&
                existing.digest !== entry.digest ? (
                  <Button
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => {
                      void perform(async () => {
                        if (isDirty && !(await canDiscard())) return;
                        const updated = result(
                          await api.PATCH("/api/v1/plugins/{id}/", {
                            params: { path: { id: existing.id } },
                            body: {
                              version: entry.version,
                              refresh_bundle: true,
                            },
                          }),
                        );
                        applyPlugin(updated);
                        setNotice(
                          "Plugin updated for future runs. Older runs still require their original executor image.",
                        );
                      });
                    }}
                  >
                    Update plugin
                  </Button>
                ) : null}

                <details className="my-3">
                  <summary>Documentation</summary>
                  <p className="small">
                    Upstream reference documentation. Use the connection form
                    below for this installation.
                  </p>
                  <MarkdownContent
                    className="max-h-80 overflow-auto"
                    content={entry.documentation}
                  />
                </details>
                {existing ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void selectPlugin(existing);
                    }}
                  >
                    Configure
                  </Button>
                ) : null}
                {!existing && canManage ? (
                  <Button
                    disabled={isBusy}
                    onClick={() => {
                      void perform(async () => {
                        if (isDirty && !(await canDiscard())) return;
                        const plugin = result(
                          await api.POST("/api/v1/plugins/", {
                            body: {
                              slug: entry.slug,
                              version: entry.version,
                              distribution: "external",
                              agent: projectId,
                              enabled: true,
                            },
                          }),
                        );
                        applyPlugin(plugin);
                        setNotice(
                          "Plugin enabled for the selected project. The runner downloads and verifies its package. Connect credentials if required.",
                        );
                      });
                    }}
                  >
                    Enable plugin
                  </Button>
                ) : null}
                {existing || canManage ? null : (
                  <p>Ask an administrator to enable this plugin.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <PluginMarketplace releases={catalogQuery.data ?? []} />
      <section className="panel">
        <ResourceState {...query} />
        <div className="panel-title">
          <h2>
            <Package size={18} /> Installed plugins
          </h2>
        </div>
        {!query.isLoading && !query.error && plugins.length === 0 ? (
          <div className="resource-empty">
            <Package size={30} />
            <h3>No plugins installed</h3>
            <p>
              Installed plugins will appear here. Ask your workspace
              administrator to provision reviewed tools.
            </p>
          </div>
        ) : undefined}
        {plugins.map((plugin) => (
          <div className="resource-row" key={plugin.id}>
            <PluginIcon url={plugin.icon_url} size={24} />
            <div>
              <strong>{plugin.display_name}</strong>
              <small>
                {project.name} · v{plugin.version} ·{" "}
                {plugin.enabled ? "Enabled" : "Disabled"} ·{" "}
                {plugin.description ?? "Custom TypeScript tools"}
              </small>
            </div>
            <div className="row">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void selectPlugin(plugin);
                }}
              >
                Inspect
              </Button>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    void perform(async () => {
                      result(
                        await api.PATCH("/api/v1/plugins/{id}/", {
                          params: { path: { id: plugin.id } },
                          body: { enabled: !plugin.enabled },
                        }),
                      );
                      setNotice(
                        plugin.enabled
                          ? "Plugin disabled for future runs."
                          : "Plugin enabled.",
                      );
                    });
                  }}
                >
                  <Power size={13} />
                  {plugin.enabled ? "Disable" : "Enable"}
                </Button>
              ) : undefined}
            </div>
          </div>
        ))}
      </section>
      {selected ? (
        <section className="panel">
          <h2>Plugin: {slug}</h2>
          {installed?.distribution === "external" ? (
            <PluginCapabilities
              slug={installed.slug}
              metadata={installed.tools}
            />
          ) : null}
          <p className="small">
            {isExternal
              ? "This plugin comes from an external release. Select a matching credential and configure it below."
              : "Changed source requires a new version. Existing runs keep their pinned plugin source."}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const body = {
                  slug,
                  version,
                  description,
                  ...(isExternal
                    ? {
                        configuration: parseConfig(config),
                      }
                    : { source }),
                  credential: credential || null,
                };
                result(
                  await api.PATCH("/api/v1/plugins/{id}/", {
                    params: { path: { id: selected } },
                    body,
                  }),
                );
                setSavedValues(currentValues);
                setNotice("Plugin saved for its project.");
              });
            }}
          >
            <div className="row">
              <label>
                Plugin slug
                <Input
                  required
                  value={slug}
                  disabled={isExternal || isBusy || !canManage}
                  onChange={(event) => {
                    setSlug(event.target.value);
                  }}
                />
              </label>
              <label>
                Plugin version
                <Input
                  required
                  value={version}
                  disabled={isExternal || isBusy || !canManage}
                  onChange={(event) => {
                    setVersion(event.target.value);
                  }}
                />
              </label>
              <label>
                Plugin credential
                <select
                  value={credential}
                  disabled={isBusy || !canManage}
                  onChange={(event) => {
                    setCredential(event.target.value);
                  }}
                >
                  <option value="">No credential</option>
                  {query.data?.credentials
                    .filter(
                      (item) =>
                        !isExternal || item.provider === release?.auth.provider,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Description
              <Input
                value={description}
                disabled={isBusy || !canManage}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </label>
            {isExternal ? (
              <>
                <p className="small">
                  {release?.auth.hint ?? "No additional setup instructions."}
                </p>
                <p>
                  <WorkspaceLink href="/credentials/">
                    Manage credentials
                  </WorkspaceLink>
                </p>
                <label>
                  Configuration (JSON)
                  <Textarea
                    value={config}
                    disabled={isBusy || !canManage}
                    onChange={(event) => {
                      setConfig(event.target.value);
                    }}
                  />
                </label>
              </>
            ) : (
              <div className="source-pane">
                <div className="source-toolbar">
                  <span>plugin.ts</span>
                  <span>TypeScript safe-functions</span>
                </div>
                <div className="desktop-editor">
                  <Editor
                    actionId={`plugin-${selected || "new"}`}
                    value={source}
                    onChange={setSource}
                    readOnly={isBusy || !canManage}
                  />
                </div>
                <div className="mobile-editor">
                  <label>
                    Plugin source
                    <Textarea
                      className="code"
                      rows={12}
                      value={source}
                      readOnly={isBusy || !canManage}
                      onChange={(event) => {
                        setSource(event.target.value);
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
            {canManage ? (
              <Button
                type="submit"
                className="mt-4"
                disabled={isBusy || !slug.trim() || !version.trim()}
              >
                Save plugin
              </Button>
            ) : (
              <p className="small">
                Only owners and admins can update plugins.
              </p>
            )}
            {canManage && selected ? (
              <Button
                type="button"
                variant="outline"
                className="ml-3 mt-4"
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    if (
                      !(await canDiscard({
                        title: "Remove this plugin?",
                        description:
                          "Its tools will be removed from future project runs. Existing runs retain their pinned source.",
                        actionLabel: "Remove plugin",
                      }))
                    )
                      return;
                    requireSuccess(
                      await api.DELETE("/api/v1/plugins/{id}/", {
                        params: { path: { id: selected } },
                      }),
                    );
                    applyPlugin();
                    setNotice("Plugin removed.");
                  });
                }}
              >
                Remove plugin
              </Button>
            ) : undefined}
          </form>
          {isExternal && release && canManage && !isDirty ? (
            <PluginConnection
              key={installed.id}
              plugin={installed}
              auth={release.auth}
              onConnected={async (id) => {
                const updated = result(
                  await api.PATCH("/api/v1/plugins/{id}/", {
                    params: { path: { id: installed.id } },
                    body: { credential: id },
                  }),
                );
                applyPlugin(updated);
                await query.refresh();
                setNotice("Credential connected for this project’s plugin.");
              }}
            />
          ) : null}
        </section>
      ) : undefined}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : undefined}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : undefined}
    </>
  );
}
