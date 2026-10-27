"use client";
import { Cable, Copy, KeyRound, Plug, Trash2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { result, errorMessage, requireSuccess } from "../api/result";
import { loadActions, loadAgents, loadTokens } from "../api/workspace-queries";
import { useWorkspaceQuery } from "../api/use-workspace-query";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ResourceState } from "./workspace/resource-state";
import { useDiscardConfirmation } from "./workspace/discard-dialog";
import { useWorkspace } from "./workspace/workspace-context";
import { useUnsavedChanges } from "./workspace/use-unsaved-changes";
import { WorkspaceLink } from "./workspace/workspace-link";
import { displayValue } from "./workspace/run-display";
const clientScopes = [
  ["catalog:read", "Discover granted projects, actions and SDK"],
  ["code:execute", "Execute one-off code in selected projects"],
  ["actions:write", "Create and version actions in selected projects"],
  ["actions:run", "Execute granted saved actions"],
  ["actions:test", "Run isolated mocked action tests"],
  ["runs:read", "Inspect this client's own runs"],
  ["runs:cancel", "Cancel this client's own runs"],
] as const;
const authorScopes = clientScopes.map(([scope]) => scope);
const runnerScopes = [
  "catalog:read",
  "actions:run",
  "runs:read",
  "runs:cancel",
];
async function loadGrantOptions(signal: AbortSignal, projectId: string) {
  const [projects, actions] = await Promise.all([
    loadAgents(signal),
    loadActions(signal),
  ]);
  const versions = await Promise.all(
    actions
      .filter((action) => (action.project ?? action.agent) === projectId)
      .map(async (action) => {
        const response = result(
          await api.GET("/api/v1/actions/{id}/versions/", {
            signal,
            params: { path: { id: action.id } },
          }),
        );
        return response.map((version) => ({
          ...version,
          actionName: action.name,
          project: action.project ?? action.agent,
        }));
      }),
  );
  return {
    projects: projects.filter((project) => project.id === projectId),
    versions: versions.flat(),
  };
}
function toggleValue(
  values: string[],
  value: string,
  isChecked: boolean,
): string[] {
  return isChecked
    ? [...values, value]
    : values.filter((item) => item !== value);
}
function isLegacy(scopes: unknown): boolean {
  return (
    Array.isArray(scopes) &&
    scopes.some((scope) => ["read", "write", "approve"].includes(String(scope)))
  );
}
export function Connections({
  canManage,
  navigate,
}: {
  canManage: boolean;
  navigate: (view: string) => void;
}): ReactNode {
  const { selected, agents, setDirty } = useWorkspace();
  const query = useWorkspaceQuery(loadTokens);
  const loadOptions = useCallback(
    (signal: AbortSignal) => loadGrantOptions(signal, selected),
    [selected],
  );
  const options = useWorkspaceQuery(loadOptions);
  const versionIds = new Set(
    options.data?.versions.map((version) => version.id),
  );
  const tokens = (query.data ?? []).filter(
    (item) =>
      isLegacy(item.scopes) ||
      (item.projects?.includes(selected) ?? false) ||
      (item.action_versions?.some((id) => versionIds.has(id)) ?? false),
  );
  const projectName =
    agents.find((project) => project.id === selected)?.name ?? "this project";
  const [projects, setProjects] = useState<string[]>(
    selected ? [selected] : [],
  );
  const [versions, setVersions] = useState<string[]>([]);
  const [grantMode, setGrantMode] = useState("projects");
  const canConfirm = useDiscardConfirmation();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(authorScopes);
  const [token, setToken] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useUnsavedChanges(name.trim() !== "" || token !== "", setDirty);
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
        <h2>
          <Cable size={18} /> Connect an agent over MCP
        </h2>
        <p>
          Choose what your agent can do in {projectName}, then add the MCP
          connection to its client. Your project controls the actions, plugins
          and workspace data available to it.
        </p>
        <div className="my-4 flex flex-wrap gap-4 text-sm">
          <WorkspaceLink
            href={`/projects/?${new URLSearchParams({ project: selected, tab: "access" }).toString()}`}
          >
            Review data access
          </WorkspaceLink>
          <WorkspaceLink
            href={`/plugins/?${new URLSearchParams({ project: selected }).toString()}`}
          >
            Manage project plugins
          </WorkspaceLink>
        </div>
        <div className="two-columns">
          <div>
            <h3>1. Create a scoped token</h3>
            <p className="small">
              Give each client its own token. Select only the access it needs,
              then save the token in that client.
            </p>
          </div>
          <div>
            <h3>2. Configure your client</h3>
            <p className="small">
              Use this workspace domain with the MCP endpoint <code>/mcp/</code>
              , or the REST API at <code>/api/v1/</code>. Send the token as{" "}
              <code>Authorization: Bearer &lt;token&gt;</code>.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${location.origin}/mcp/`)
                  .then(() => {
                    setNotice("MCP endpoint copied.");
                  })
                  .catch(() => {
                    setError(
                      "Could not copy. Use this workspace domain followed by /mcp/.",
                    );
                  });
              }}
            >
              <Copy size={13} />
              Copy MCP endpoint
            </Button>
          </div>
        </div>
        <p className="small">
          Activity reflects requests observed locally since tracking began, not
          whether a client is online. Recently used means a request in the last
          seven days; inactive means no request in that window. Never used means
          no observed request, including tokens issued before tracking began.
        </p>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Clients with access to {projectName}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void query.refresh();
            }}
          >
            Refresh activity
          </Button>
        </div>
        <ResourceState {...query} />
        <ResourceState {...options} />
        {query.data ? (
          <p className="small">
            {
              tokens.filter((item) => !item.revoked && item.request_count > 0)
                .length
            }{" "}
            current tokens used ·{" "}
            {
              tokens.filter((item) => !item.revoked && item.request_count === 0)
                .length
            }{" "}
            never observed · {tokens.filter((item) => item.revoked).length}{" "}
            revoked
          </p>
        ) : undefined}
        {!query.isLoading &&
        !options.isLoading &&
        !query.error &&
        !options.error &&
        tokens.length === 0 ? (
          <p>No clients have been granted access to this project yet.</p>
        ) : undefined}
        {tokens.map((item) => (
          <div className="resource-row" key={item.id}>
            <KeyRound size={17} />
            <div>
              <strong>{item.name}</strong>
              <small>
                {isLegacy(item.scopes)
                  ? "Legacy broad token · replace with explicit grants"
                  : "Scoped client token"}{" "}
                · {displayValue(item.scopes)} ·{" "}
                {item.activity_state.replaceAll("_", " ")}
              </small>
              <small>
                Projects:{" "}
                {item.projects
                  ?.map(
                    (id) =>
                      options.data?.projects.find(
                        (project) => project.id === id,
                      )?.name ?? id,
                  )
                  .join(", ") ?? "None"}
              </small>
              <small>
                Exact action versions:{" "}
                {item.action_versions
                  ?.map((id) => {
                    const version = options.data?.versions.find(
                      (version) => version.id === id,
                    );
                    return version
                      ? `${version.actionName} · version ${String(version.number)}`
                      : id;
                  })
                  .join(", ") ?? "None"}
              </small>
              <small>
                {item.request_count} requests · {item.success_count} successful
                · {item.error_count} errors · {item.rest_request_count} REST ·{" "}
                {item.mcp_request_count} MCP
              </small>
              <small>
                First observed:{" "}
                {item.first_used_at
                  ? new Date(item.first_used_at).toLocaleString()
                  : "Never"}{" "}
                · Last observed:{" "}
                {item.last_used_at
                  ? new Date(item.last_used_at).toLocaleString()
                  : "Never"}
              </small>
              {item.last_used_at ? (
                <small>
                  Last outcome: {item.last_outcome} · {item.last_transport} ·
                  HTTP {item.last_status_code}
                </small>
              ) : undefined}
            </div>
            {canManage && !item.revoked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  void perform(async () => {
                    if (
                      !(await canConfirm({
                        title: "Revoke this client's access?",
                        description:
                          "The client will no longer be able to use this workspace with its token.",
                        actionLabel: "Revoke token",
                      }))
                    )
                      return;
                    requireSuccess(
                      await api.DELETE("/api/v1/tokens/{id}/", {
                        params: { path: { id: item.id } },
                      }),
                    );
                    setNotice("Client token revoked.");
                  });
                }}
              >
                <Trash2 size={13} />
                Revoke
              </Button>
            ) : undefined}
          </div>
        ))}
      </section>
      <p className="small">
        Counts include requests with a valid token identity and current
        membership, including scope denials. Errors include HTTP failures and
        MCP protocol or tool errors, even with HTTP 200. Request bodies and
        secrets are not stored.
      </p>
      {canManage ? (
        <section className="panel">
          <h2>Create access token</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const issued = result(
                  await api.POST("/api/v1/tokens/", {
                    body: {
                      name,
                      scopes,
                      projects: grantMode === "projects" ? projects : [],
                      action_versions: grantMode === "versions" ? versions : [],
                    },
                  }),
                );
                setToken(issued.token);
                setName("");
                setNotice(
                  "Token created. Copy it now; it will not be shown again.",
                );
              });
            }}
          >
            <label>
              Client name
              <Input
                required
                value={name}
                disabled={isBusy}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="e.g. Local MCP client"
              />
            </label>
            <label>
              Permission preset
              <select
                disabled={isBusy}
                defaultValue="author"
                onChange={(event) => {
                  const isAuthor = event.target.value === "author";
                  setScopes(isAuthor ? authorScopes : runnerScopes);
                  setGrantMode(isAuthor ? "projects" : "versions");
                }}
              >
                <option value="author">
                  Authoring client — explore code, save and test actions
                </option>
                <option value="runner">
                  Action runner — execute selected saved versions
                </option>
              </select>
            </label>
            <fieldset>
              <legend>Actual operations granted</legend>
              {clientScopes.map(([scope, label]) => (
                <label className="check" key={scope}>
                  <Input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    disabled={isBusy}
                    onChange={(event) => {
                      setScopes((previous) =>
                        event.target.checked
                          ? [...previous, scope]
                          : previous.filter((item) => item !== scope),
                      );
                    }}
                  />
                  {label} <code>{scope}</code>
                </label>
              ))}
            </fieldset>
            <fieldset disabled={isBusy}>
              <legend>Resource grants</legend>
              <label>
                Grant access to
                <select
                  value={grantMode}
                  onChange={(event) => {
                    setGrantMode(event.target.value);
                  }}
                >
                  <option value="projects">Selected projects</option>
                  <option value="versions">
                    Exact immutable action versions
                  </option>
                </select>
              </label>
              <ResourceState {...options} />
              {grantMode === "projects"
                ? options.data?.projects.map((project) => (
                    <label className="check" key={project.id}>
                      <input
                        type="checkbox"
                        checked={projects.includes(project.id)}
                        onChange={(event) => {
                          setProjects((previous) =>
                            toggleValue(
                              previous,
                              project.id,
                              event.target.checked,
                            ),
                          );
                        }}
                      />
                      {project.name}
                    </label>
                  ))
                : options.data?.versions.map((version) => (
                    <label className="check" key={version.id}>
                      <input
                        type="checkbox"
                        checked={versions.includes(version.id)}
                        onChange={(event) => {
                          setVersions((previous) =>
                            toggleValue(
                              previous,
                              version.id,
                              event.target.checked,
                            ),
                          );
                        }}
                      />
                      {version.actionName} · version {version.number} ·{" "}
                      {
                        options.data?.projects.find(
                          (project) => project.id === version.project,
                        )?.name
                      }
                    </label>
                  ))}
              {grantMode === "versions" &&
              scopes.some((scope) =>
                ["code:execute", "actions:write"].includes(scope),
              ) ? (
                <p className="error">
                  Code execution and action authoring require a project grant.
                  Remove these operations or select projects.
                </p>
              ) : null}
              <p className="small">
                Project grants include current and future actions in those
                projects. Exact-version grants permit only the versions selected
                here. Clients cannot manage plugins, credentials, grants or
                approvals. Existing keys retain their current authority until
                revoked.
              </p>
            </fieldset>
            <Button
              type="submit"
              disabled={
                isBusy ||
                !!token ||
                scopes.length === 0 ||
                (grantMode === "projects"
                  ? projects.length === 0
                  : versions.length === 0 ||
                    scopes.some((scope) =>
                      ["code:execute", "actions:write"].includes(scope),
                    ))
              }
            >
              Create token
            </Button>
          </form>
          {token ? (
            <div className="issued-token">
              <label>
                New access token
                <Input
                  type="password"
                  readOnly
                  autoComplete="off"
                  value={token}
                />
              </label>
              <p className="small">
                Configure your client’s HTTP MCP transport with this workspace’s{" "}
                <code>/mcp/</code> endpoint and an{" "}
                <code>Authorization: Bearer</code> header containing this token.
                Keep the token in the client’s secret configuration. OrgSDK does
                not require a model account.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      JSON.stringify(
                        {
                          mcpServers: {
                            orgsdk: {
                              type: "http",
                              url: `${location.origin}/mcp/`,
                              headers: { Authorization: `Bearer ${token}` },
                            },
                          },
                        },
                        null,
                        2,
                      ),
                    )
                    .then(() => {
                      setNotice(
                        "MCP configuration copied. Store it privately in your client configuration.",
                      );
                    })
                    .catch(() => {
                      setError(
                        "Clipboard unavailable. Configure the endpoint and authorization header manually.",
                      );
                    });
                }}
              >
                Copy MCP configuration
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(token)
                    .then(() => {
                      setNotice("Token copied.");
                    })
                    .catch(() => {
                      setError(
                        "Clipboard access failed. Select and copy the new token field.",
                      );
                    });
                }}
              >
                <Copy size={13} />
                Copy token
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setToken("");
                }}
              >
                Dismiss token
              </Button>
            </div>
          ) : undefined}
        </section>
      ) : (
        <p className="notice">
          Only owners and admins can issue or revoke access tokens.
        </p>
      )}
      <div className="quick-grid">
        <button
          className="quick-action"
          onClick={() => {
            navigate("credentials");
          }}
        >
          <KeyRound size={18} />
          <strong>Credentials</strong>
          <span>Manage encrypted provider secrets.</span>
        </button>
        <button
          className="quick-action"
          onClick={() => {
            navigate("plugins");
          }}
        >
          <Plug size={18} />
          <strong>Plugins</strong>
          <span>Install and configure your projects’ integrations.</span>
        </button>
      </div>
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
