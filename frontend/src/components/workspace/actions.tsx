"use client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { PageHeader } from "./page-header";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { defaultSchedule } from "../../lib/schedule-timing";
import { SchedulePicker } from "./schedule-picker";
import { useWorkspace } from "./workspace-context";
import { ActionChecks } from "./action-checks";
import { ActionSettings } from "./action-settings";
import { useDiscardConfirmation } from "./discard-dialog";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Braces,
  CalendarClock,
  Code2,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  Save,
} from "lucide-react";
import { parseActionJSON } from "./action-json";
import { api } from "../../api/client";
import { loadActions, loadRuns } from "../../api/workspace-queries";
import { result, errorMessage, requireSuccess } from "../../api/result";
import type { components } from "../../api/schema";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { ActionPlugins } from "./action-plugins";
import { ActionResults, ActionRunHistory } from "./action-results";
import { ResourceState } from "./resource-state";
import { RunStatus } from "./run-display";
import { ActionNavigation } from "./action-navigation";
import { WorkspaceLink } from "./workspace-link";
const Editor = dynamic(
  async () => {
    const editorModule = await import("./action-editor");
    editorModule.configureMonaco();
    return editorModule.default;
  },
  { ssr: false },
);
type Action = components["schemas"]["Action"];
type Version = components["schemas"]["Version"];
const initialSource =
  'const { name } = actionParams;\nreturn `Hello, ${name ?? "world"}!`;';
function ActionWorkspace({
  agents,
  onDirtyChange,
  selectedId,
  onSelect,
}: {
  agents: components["schemas"]["Agent"][];
  onDirtyChange: (isDirty: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}): ReactNode {
  const { selected: projectId } = useWorkspace();
  const router = useRouter();
  const canDiscardChanges = useDiscardConfirmation();
  const [actions, setActions] = useState<Action[]>([]);
  const [selected, setSelected] = useState<Action | undefined>();
  const [agent, setAgent] = useState(projectId || (agents[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [source, setSource] = useState(initialSource);
  const [savedSource, setSavedSource] = useState(initialSource);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState("");
  const initialSchema = '{"type":"object"}';
  const [testsDirty, setTestsDirty] = useState(false);
  const [inputSchema, setInputSchema] = useState(initialSchema);
  const [savedSchema, setSavedSchema] = useState(initialSchema);
  const [outputSchema, setOutputSchema] = useState("{}");
  const [savedOutputSchema, setSavedOutputSchema] = useState("{}");
  const [inputs, setInputs] = useState('{"name": "team"}');
  const [cron, setCron] = useState(defaultSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editorTab, setEditorTab] = useState("source");
  const editorLanguage = editorTab === "source" ? "TypeScript" : "JSON";
  const [expanded, setExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState("");
  const actionId = selected?.id;
  const loadHistory = useCallback(
    async (signal: AbortSignal) => (actionId ? loadRuns(signal) : []),
    [actionId],
  );
  const runQuery = useWorkspaceQuery(loadHistory, actionId ? 5000 : 0);
  const versionIds = new Set(versions.map((version) => version.id));
  const runs = (runQuery.data ?? [])
    .filter(
      (run) =>
        run.action_version !== null && versionIds.has(run.action_version),
    )
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at));
  const lastRun = runs[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? lastRun;
  const isDirty =
    source !== savedSource ||
    inputSchema !== savedSchema ||
    outputSchema !== savedOutputSchema ||
    (!selected && name !== "");
  const latest = versions[0];
  const savedStatus = latest ? "Saved" : "Draft";
  const editStatus = isDirty ? "Unsaved changes" : savedStatus;
  const isHistorical = !!versionId && versionId !== latest?.id;
  const canRun =
    !!selected && selected.enabled !== false && !!versionId && !isDirty;
  const scheduleUnavailableReason = (): string => {
    if (!selected || !latest)
      return "Save this action before creating a schedule.";
    if (selected.enabled === false)
      return "Enable this action before creating a schedule.";
    return isHistorical
      ? "Choose the latest version before creating a schedule."
      : "Save your changes before creating a schedule.";
  };

  useUnsavedChanges(isDirty || testsDirty, onDirtyChange);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const allActions = await loadActions(controller.signal);
        controller.signal.throwIfAborted();
        const list = allActions.filter(
          (action) => (action.project ?? action.agent) === projectId,
        );
        setActions(list);
        if (selectedId) {
          const action = list.find((item) => item.id === selectedId);
          if (!action)
            throw new Error(
              "This action does not exist or is not available in this workspace.",
            );
          const data = result(
            await api.GET("/api/v1/actions/{id}/versions/", {
              params: { path: { id: action.id } },
              signal: controller.signal,
            }),
          );
          controller.signal.throwIfAborted();
          const ordered = data.toSorted((a, b) => b.number - a.number);
          const version = ordered[0];
          setSelected(action);
          setAgent(action.project ?? action.agent ?? projectId);
          setName(action.name);
          setVersions(ordered);
          setVersionId(version?.id ?? "");
          setSource(version?.source ?? initialSource);
          setSavedSource(version?.source ?? initialSource);
          const schema = JSON.stringify(
            version?.input_schema ?? { type: "object" },
          );
          setInputSchema(schema);
          setSavedSchema(schema);
          const output = JSON.stringify(version?.output_schema ?? {});
          setOutputSchema(output);
          setSavedOutputSchema(output);
          setError("");
        }
      } catch (error_) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error_));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [selectedId, projectId, loadAttempt]);
  if (loading)
    return (
      <>
        <PageHeader>
          <strong>Actions</strong>
        </PageHeader>
        <p role="status">Loading actions…</p>
      </>
    );
  if (loadError)
    return (
      <section className="panel space-y-4">
        <h1>Action unavailable</h1>
        <p className="error" role="alert">
          {loadError}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <WorkspaceLink
              href={`/actions/?project=${encodeURIComponent(projectId)}`}
            >
              Back to actions
            </WorkspaceLink>
          </Button>
          <Button
            onClick={() => {
              setLoadError("");
              setLoading(true);
              setLoadAttempt((previous) => previous + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </section>
    );
  const perform = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  const canDiscard = async (): Promise<boolean> =>
    !(isDirty || testsDirty) || (await canDiscardChanges());
  const resetEditor = (): void => {
    setTestsDirty(false);
    setSelected(undefined);
    setVersions([]);
    setVersionId("");
    setName("");
    setSource(initialSource);
    setSavedSource(initialSource);
    setInputSchema(initialSchema);
    setSavedSchema(initialSchema);
    setOutputSchema("{}");
    setSavedOutputSchema("{}");
    setSelectedRunId("");
    setEditorTab("source");
  };
  const selectAction = async (action?: Action): Promise<void> => {
    if (action || selectedId) {
      onSelect(action?.id ?? "");
      return;
    }
    if (!(await canDiscard())) return;
    resetEditor();
    setError("");
    setNotice("");
  };
  const selectVersion = async (selectedVersionId: string): Promise<void> => {
    if (!(await canDiscard())) return;
    const version = versions.find((item) => item.id === selectedVersionId);
    if (!version) return;
    setTestsDirty(false);
    setVersionId(version.id);
    setSource(version.source);
    setSavedSource(version.source);
    const schema = JSON.stringify(version.input_schema ?? { type: "object" });
    setInputSchema(schema);
    setSavedSchema(schema);
    const output = JSON.stringify(version.output_schema ?? {});
    setOutputSchema(output);
    setSavedOutputSchema(output);
  };
  const save = async (): Promise<void> => {
    if (testsDirty && !(await canDiscardChanges())) return;
    const parsedSchema: unknown = parseActionJSON(inputSchema);
    const parsedOutput: unknown = parseActionJSON(outputSchema);
    let action = selected;
    if (!action) {
      action = result(
        await api.POST("/api/v1/actions/", {
          body: { project: agent, name: name.trim() },
        }),
      );
      setSelected(action);
      const createdAction = action;
      setActions((previous) => [...previous, createdAction]);
    }
    const saved = result(
      await api.POST("/api/v1/actions/{id}/versions/", {
        params: { path: { id: action.id } },
        body: {
          source,
          input_schema: parsedSchema,
          output_schema: parsedOutput,
        },
      }),
    );
    setTestsDirty(false);
    setVersions((previous) => [
      saved,
      ...previous.filter((version) => version.id !== saved.id),
    ]);
    setVersionId(saved.id);
    setSavedSource(source);
    setSavedSchema(inputSchema);
    setSavedOutputSchema(outputSchema);
    setNotice(`Version ${String(saved.number)} saved.`);
    if (selectedId) return;
    const query = new URLSearchParams({ project: agent, action: action.id });
    router.replace(`/actions/?${query.toString()}`);
  };
  const run = async (): Promise<void> => {
    const version = versions.find((item) => item.id === versionId);
    if (!selected || !canRun || !version) return;
    const parsed: unknown = parseActionJSON(inputs);
    const created = result(
      await api.POST("/api/v1/runs/", {
        body: {
          project: agent,
          action: selected.id,
          operation: "action",
          version: version.number,
          inputs: parsed,
          idempotency_key: crypto.randomUUID(),
        },
      }),
    );
    setSelectedRunId(created.id);
    await runQuery.refresh();
    setNotice("Run queued. Follow its progress and results below.");
  };
  const jsonEditors: Record<
    string,
    { description: string; label: string; value: string }
  > = {
    schema: {
      description:
        "Define the JSON Schema used to validate this version’s run inputs.",
      label: "Input schema (JSON)",
      value: inputSchema,
    },
    output: {
      description:
        "Define the JSON Schema used to validate this version’s returned output.",
      label: "Output schema (JSON)",
      value: outputSchema,
    },
    inputs: {
      description: "Provide the JSON inputs for your next run or schedule.",
      label: "Run inputs (JSON)",
      value: inputs,
    },
  };
  const jsonEditor = jsonEditors[editorTab];
  return (
    <div className="actions-workspace">
      <section className="action-detail" aria-label="Action editor">
        <PageHeader>
          <div className="action-toolbar">
            <h1 className="sr-only">{selected?.name ?? "New action"}</h1>
            <nav className="action-breadcrumb" aria-label="Action navigation">
              <Code2 size={16} aria-hidden="true" />
              <WorkspaceLink
                href={`/actions/?project=${encodeURIComponent(projectId)}`}
              >
                Actions
              </WorkspaceLink>
              <span aria-hidden="true">/</span>
              <Select
                value={selected?.id ?? "new"}
                disabled={busy}
                onValueChange={(value) => {
                  void selectAction(
                    actions.find((action) => action.id === value),
                  );
                }}
              >
                <SelectTrigger
                  aria-label="Choose action"
                  className="action-selector"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New action</SelectItem>
                  {actions.map((action) => (
                    <SelectItem key={action.id} value={action.id}>
                      {action.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span
                className={`action-save-status ${isDirty ? "is-dirty" : ""}`}
              >
                {editStatus}
              </span>
              {selected?.enabled === false ? (
                <span className="badge">Disabled</span>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label="New action"
                title="New action"
                onClick={() => {
                  void selectAction();
                }}
              >
                <Plus size={15} />
              </Button>
            </nav>
            <div className="row action-header-controls">
              {lastRun ? (
                <div className="action-last-run">
                  <span>Last run</span>
                  <RunStatus status={lastRun.status} />
                  <small>{new Date(lastRun.created_at).toLocaleString()}</small>
                </div>
              ) : null}
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !source.trim() ||
                  (!selected && (!name.trim() || !agent))
                }
                onClick={() => {
                  void perform(save);
                }}
              >
                <Save size={15} />{" "}
                {isHistorical ? "Save as new version" : "Save version"}
              </Button>
              <Button
                className="secondary"
                disabled={busy || !canRun}
                onClick={() => {
                  void perform(run);
                }}
              >
                <Play size={15} /> Run selected version
              </Button>
            </div>
          </div>
        </PageHeader>
        {selected ? (
          <ActionNavigation action={selected} current="editor" />
        ) : (
          <div className="mb-5 space-y-2">
            <WorkspaceLink
              href={`/actions/?project=${encodeURIComponent(projectId)}`}
            >
              Back to actions
            </WorkspaceLink>
            <h1>New action</h1>
            <p>Save reusable code for your connected MCP client to run.</p>
          </div>
        )}
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
        {selected ? undefined : (
          <div className="panel row action-create-fields">
            <label>
              Action name
              <Input
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="e.g. Daily report"
              />
            </label>
            <label>
              Project
              <Input
                readOnly
                value={
                  agents.find((project) => project.id === projectId)?.name ??
                  "No project selected"
                }
              />
              <small>
                Choose a project in the sidebar before creating an action.
              </small>
            </label>
          </div>
        )}
        {agents.length === 0 ? (
          <p className="notice">
            Create a project from Projects before saving an action.
          </p>
        ) : undefined}
        <ResourceState {...runQuery} />
        <div
          className={`action-content-grid ${expanded ? "is-editor-expanded" : ""}`}
        >
          <div className="action-editor-column">
            <div className="source-pane action-source-pane">
              <div className="source-toolbar">
                <div
                  className="action-editor-tabs"
                  role="group"
                  aria-label="Action configuration"
                >
                  <button
                    type="button"
                    className={editorTab === "source" ? "is-active" : ""}
                    aria-pressed={editorTab === "source"}
                    onClick={() => {
                      setEditorTab("source");
                    }}
                  >
                    <span className="typescript-icon">TS</span> action.ts{" "}
                    {isDirty ? (
                      <span className="unsaved-dot" title="Unsaved changes" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={editorTab === "schema" ? "is-active" : ""}
                    aria-pressed={editorTab === "schema"}
                    onClick={() => {
                      setEditorTab("schema");
                    }}
                  >
                    <Braces size={14} /> Input schema
                  </button>
                  <button
                    type="button"
                    className={editorTab === "output" ? "is-active" : ""}
                    aria-pressed={editorTab === "output"}
                    onClick={() => {
                      setEditorTab("output");
                    }}
                  >
                    <Braces size={14} /> Output schema
                  </button>
                  <button
                    type="button"
                    className={editorTab === "inputs" ? "is-active" : ""}
                    aria-pressed={editorTab === "inputs"}
                    onClick={() => {
                      setEditorTab("inputs");
                    }}
                  >
                    <Braces size={14} /> Run inputs
                  </button>
                  <button
                    type="button"
                    className={editorTab === "schedule" ? "is-active" : ""}
                    aria-pressed={editorTab === "schedule"}
                    onClick={() => {
                      setEditorTab("schedule");
                    }}
                  >
                    <CalendarClock size={14} /> Schedule
                  </button>
                </div>
                <div className="row">
                  {versions.length > 0 ? (
                    <Select
                      value={versionId}
                      disabled={busy}
                      onValueChange={(value) => {
                        void selectVersion(value);
                      }}
                    >
                      <SelectTrigger
                        aria-label="Action version"
                        className="action-version-selector"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {versions.map((version) => (
                          <SelectItem key={version.id} value={version.id}>
                            Version {version.number}
                            {version.id === latest?.id ? " (latest)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={expanded ? "Collapse editor" : "Expand editor"}
                    aria-pressed={expanded}
                    onClick={() => {
                      setExpanded(!expanded);
                    }}
                  >
                    {expanded ? (
                      <Minimize2 size={15} />
                    ) : (
                      <Maximize2 size={15} />
                    )}
                  </Button>
                </div>
              </div>
              {editorTab === "source" ? (
                <>
                  <div className="desktop-editor">
                    <Editor
                      value={source}
                      onChange={setSource}
                      readOnly={busy}
                      actionId={`${agent}:${selected?.id ?? "new"}:${versionId}`}
                      projectId={agent}
                      theme="light"
                      height="100%"
                    />
                  </div>
                  <div className="mobile-editor">
                    <label>
                      TypeScript source
                      <Textarea
                        className="code"
                        rows={18}
                        spellCheck={false}
                        value={source}
                        readOnly={busy}
                        onChange={(event) => {
                          setSource(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                </>
              ) : null}
              {editorTab === "schedule" ? (
                <section
                  className="action-schedule-editor"
                  aria-labelledby="action-schedule-title"
                >
                  <h3 id="action-schedule-title">Schedule action</h3>
                  {selected ? (
                    <WorkspaceLink
                      href={`/schedules/?${new URLSearchParams({ project: agent, action: selected.id }).toString()}`}
                    >
                      View saved schedules
                    </WorkspaceLink>
                  ) : null}
                  <p className="small">
                    Creating a schedule copies the current Run inputs. Scheduled
                    runs use this action’s latest saved version.
                  </p>
                  {canRun && !isHistorical ? null : (
                    <p className="notice" role="status">
                      {scheduleUnavailableReason()}
                    </p>
                  )}
                  <SchedulePicker
                    value={cron}
                    onChange={setCron}
                    disabled={busy}
                  />
                  <Button
                    className="secondary"
                    disabled={busy || !canRun || isHistorical}
                    onClick={() => {
                      void perform(async () => {
                        if (!selected || !canRun) return;
                        const parsed: unknown = parseActionJSON(inputs);
                        result(
                          await api.POST("/api/v1/schedules/", {
                            body: { action: selected.id, cron, inputs: parsed },
                          }),
                        );
                        setNotice("Schedule created.");
                      });
                    }}
                  >
                    Create schedule
                  </Button>
                </section>
              ) : null}
              {jsonEditor ? (
                <div className="action-json-editor">
                  <p className="small">{jsonEditor.description}</p>
                  <label>
                    {jsonEditor.label}
                    <Textarea
                      className="code"
                      spellCheck={false}
                      value={jsonEditor.value}
                      readOnly={busy}
                      onChange={(event) => {
                        if (editorTab === "schema")
                          setInputSchema(event.target.value);
                        else if (editorTab === "output")
                          setOutputSchema(event.target.value);
                        else setInputs(event.target.value);
                      }}
                    />
                  </label>
                </div>
              ) : null}
              <footer className="source-footer">
                <span>
                  {editorTab === "schedule" ? "Schedule" : editorLanguage}
                </span>
                <span>
                  {isHistorical
                    ? "Historical version · edits save a new version"
                    : editStatus}
                </span>
              </footer>
            </div>
            <ActionResults
              runs={runs}
              run={selectedRun}
              onSelect={setSelectedRunId}
            />
          </div>
          <aside
            className="action-context-column"
            aria-label="Plugins and recent runs"
          >
            <ActionPlugins
              key={agent}
              agent={agents.find((item) => item.id === agent)}
            />
            <section
              className="action-card action-recent-runs"
              aria-label="Recent action runs"
            >
              <div className="action-panel-heading">
                <h3>Previous runs</h3>
                <span className="count">
                  {runs.length} {runs.length === 1 ? "run" : "runs"}
                </span>
              </div>
              <ActionRunHistory
                runs={runs}
                selectedId={selectedRun?.id ?? ""}
                onSelect={setSelectedRunId}
              />
            </section>
          </aside>
        </div>
        <ActionChecks
          key={`${agent}:${selected?.id ?? "new"}:${versionId}`}
          project={agent}
          action={selected}
          version={versions.find((version) => version.id === versionId)}
          source={source}
          inputSchema={inputSchema}
          outputSchema={outputSchema}
          dirty={isDirty}
          onDirtyChange={setTestsDirty}
        />
        {versions.find((version) => version.id === versionId)?.promoted_from ? (
          <p className="small">
            Promoted from run{" "}
            {
              versions.find((version) => version.id === versionId)
                ?.promoted_from
            }
          </p>
        ) : null}

        {isDirty || isHistorical ? (
          <p className="small" role="status">
            {isHistorical
              ? "Running uses the selected saved version. Editing and saving creates a new immutable version."
              : "Save your changes before running or scheduling this action."}
          </p>
        ) : undefined}
        <div className="action-configuration">
          {selected ? (
            <ActionSettings
              key={selected.id}
              action={selected}
              isBusy={busy}
              save={(body) => {
                void perform(async () => {
                  const updated = result(
                    await api.PATCH("/api/v1/actions/{id}/", {
                      params: { path: { id: selected.id } },
                      body,
                    }),
                  );
                  setSelected(updated);
                  setActions((previous) =>
                    previous.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  );
                  setNotice("Action settings saved.");
                });
              }}
              remove={() => {
                void perform(async () => {
                  if (
                    !(await canDiscardChanges({
                      title: "Delete this action?",
                      description:
                        "This removes the action and its saved versions. Actions referenced by retained run history cannot be deleted.",
                      actionLabel: "Delete action",
                    }))
                  )
                    return;
                  requireSuccess(
                    await api.DELETE("/api/v1/actions/{id}/", {
                      params: { path: { id: selected.id } },
                    }),
                  );
                  setActions((previous) =>
                    previous.filter((item) => item.id !== selected.id),
                  );
                  resetEditor();
                  router.replace(
                    `/actions/?project=${encodeURIComponent(projectId)}`,
                  );
                });
              }}
            />
          ) : undefined}
        </div>
      </section>
    </div>
  );
}

export function Actions(
  properties: Parameters<typeof ActionWorkspace>[0],
): ReactNode {
  const { selected: projectId } = useWorkspace();
  return (
    <ActionWorkspace
      key={`${projectId}:${properties.selectedId}`}
      {...properties}
    />
  );
}
