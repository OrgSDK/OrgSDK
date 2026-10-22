"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "./workspace-context";
import { WorkspaceLink } from "./workspace-link";

export function ProjectSelector({
  onNavigate,
}: {
  onNavigate: () => void;
}): ReactNode {
  const {
    agents: projects,
    selected,
    switchProject,
    canManage,
  } = useWorkspace();
  return (
    <div className="border-b border-slate-200 px-4 py-4">
      <label
        htmlFor="workspace-project"
        className="mb-2! text-xs text-slate-500"
      >
        Project
      </label>
      <select
        id="workspace-project"
        value={selected}
        disabled={projects.length === 0}
        className="min-w-0 text-sm"
        onChange={(event) => {
          void switchProject(event.target.value);
        }}
      >
        {selected ? null : (
          <option value="">
            {projects.length === 0 ? "No projects yet" : "Choose a project"}
          </option>
        )}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {canManage ? (
        <WorkspaceLink
          className="mt-3 flex items-center gap-2 text-xs font-medium"
          href="/projects/?new=1"
          onNavigate={onNavigate}
        >
          <Plus size={14} aria-hidden="true" />
          New project
        </WorkspaceLink>
      ) : null}
    </div>
  );
}
