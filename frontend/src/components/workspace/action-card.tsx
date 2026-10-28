"use client";
import type { Action } from "../../api/types";

import { ArrowUpRight, Code2 } from "lucide-react";
import type { ReactNode } from "react";
import { WorkspaceLink } from "./workspace-link";

export function ActionCard({ action }: { action: Action }): ReactNode {
  const description = action.description.trim();
  const query = new URLSearchParams({
    project: action.project,
    action: action.id,
  }).toString();

  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <Code2
          size={20}
          className="shrink-0 text-indigo-600"
          aria-hidden="true"
        />
        <span
          className={
            action.enabled
              ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
              : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
          }
        >
          {action.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-base font-semibold">
          <WorkspaceLink
            href={`/actions/?${query}`}
            className="flex items-start justify-between gap-3 hover:underline"
          >
            <span className="break-words">{action.name}</span>
            <ArrowUpRight
              size={17}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
          </WorkspaceLink>
        </h3>
        <p className="text-sm leading-relaxed">
          {description.length > 0
            ? description
            : "Open this action to review its code, inputs and saved versions."}
        </p>
      </div>
      <nav
        className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm"
        aria-label={`${action.name} related records`}
      >
        <WorkspaceLink href={`/runs/?${query}`} className="hover:underline">
          Runs
        </WorkspaceLink>
        <WorkspaceLink
          href={`/schedules/?${query}`}
          className="hover:underline"
        >
          Schedules
        </WorkspaceLink>
        <WorkspaceLink href={`/webhooks/?${query}`} className="hover:underline">
          Webhooks
        </WorkspaceLink>
      </nav>
    </article>
  );
}
