"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Folder, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../../api/client";
import { result, errorMessage } from "../../../api/result";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Workbench } from "../../../components/workbench";
import { useWorkspace } from "../../../components/workspace/workspace-context";
import { WorkspaceLink } from "../../../components/workspace/workspace-link";
import { useUnsavedChanges } from "../../../components/workspace/use-unsaved-changes";

export default function Page(): ReactNode {
  const {
    agents: projects,
    selected,
    setDirty,
    refresh,
    navigateTo,
  } = useWorkspace();
  const parameters = useSearchParams();
  const current = projects.find((project) => project.id === selected);
  if (parameters.get("new") === "1") {
    return (
      <CreateProject
        onCancel={() => {
          void navigateTo(
            current
              ? `/projects/?project=${encodeURIComponent(current.id)}`
              : "/projects/",
          );
        }}
      />
    );
  }
  if (current) {
    const tab =
      (["access", "runner", "settings"] as const).find(
        (item) => item === parameters.get("tab"),
      ) ?? "overview";
    return (
      <Workbench
        key={current.id}
        agent={current}
        tab={tab}
        refresh={refresh}
        onDirtyChange={setDirty}
      />
    );
  }
  return (
    <section className="empty">
      <Folder className="mx-auto" size={32} />
      <h2 className="!mt-4">Create your first project</h2>
      <p>
        A project gives your MCP agent a place to build actions, run work and
        access the data you choose.
      </p>
      <Button asChild className="mt-5">
        <WorkspaceLink href="/projects/?new=1">
          <Plus size={16} />
          Create project
        </WorkspaceLink>
      </Button>
    </section>
  );
}
function CreateProject({ onCancel }: { onCancel: () => void }): ReactNode {
  const { setSelected, setDirty, refresh } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useUnsavedChanges(name.trim() !== "", setDirty);
  const create = async (): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const project = result(
        await api.POST("/api/v1/projects/", { body: { name: name.trim() } }),
      );
      setSelected(project.id);
      await refresh();
      setDirty(false);
      router.push(`/projects/?project=${encodeURIComponent(project.id)}`);
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>Create a project</h2>
      <p className="small mb-5">
        Give your project a name, configure its runner and data access, then
        connect your agent over MCP.
      </p>
      <form
        className="max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          Project name
          <Input
            autoFocus
            required
            value={name}
            disabled={isBusy}
            placeholder="e.g. Operations"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <div className="row">
          <Button type="submit" disabled={isBusy || !name.trim()}>
            {isBusy ? "Creating…" : "Create project"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="error mt-4">
          {error}
        </p>
      ) : undefined}
    </section>
  );
}
