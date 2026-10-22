"use client";
import { useState, type ReactNode } from "react";
import {
  Braces,
  ChevronDown,
  GitBranch,
  Globe,
  Mail,
  Package,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { components } from "../../api/schema";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadPlugins } from "../../api/workspace-queries";
import { Input } from "../ui/input";
import { ResourceState } from "./resource-state";
import type { ToolInspection } from "../../lib/inline-plugin-tools";
import { pinnedPluginTools } from "../../lib/plugin-tools";
import { WorkspaceLink } from "./workspace-link";

async function loadPluginPanel(signal: AbortSignal) {
  const plugins = await loadPlugins(signal);
  let inspect: ((source: string) => ToolInspection) | undefined;
  if (plugins.some((plugin) => plugin.distribution === "inline")) {
    const parser = await import("../../lib/inline-plugin-tools");
    inspect = parser.inspectInlinePlugin;
  }
  const tools = new Map<string, ToolInspection>();
  for (const plugin of plugins) {
    tools.set(
      plugin.id,
      plugin.distribution === "inline"
        ? (inspect?.(plugin.source ?? "") ?? { tools: [], isComplete: false })
        : pinnedPluginTools(plugin.tools),
    );
  }
  return { plugins, tools };
}
function toolAvailabilityNote(isComplete: boolean, isInline: boolean): string {
  if (isComplete) return "This plugin declares no tools.";
  return isInline
    ? "Tool definitions are dynamic or could not be read. Their names cannot be listed without running the plugin."
    : "This installed release does not include tool information.";
}

const pluginIcons: Record<string, LucideIcon | undefined> = {
  gmail: Mail,
  github: GitBranch,
  browser: Globe,
  serper: Search,
};
function pluginIcon(slug: string) {
  return pluginIcons[slug] ?? Package;
}
export function ActionPlugins({
  agent,
}: {
  agent: components["schemas"]["Agent"] | undefined;
}): ReactNode {
  const query = useWorkspaceQuery(loadPluginPanel);
  const [search, setSearch] = useState("");
  const assigned =
    query.data?.plugins.filter((plugin) =>
      agent?.plugins.includes(plugin.id),
    ) ?? [];
  const entries = assigned
    .map((plugin) => {
      const inspection = query.data?.tools.get(plugin.id) ?? {
        tools: [],
        isComplete: false,
      };
      const tools = inspection.tools;
      const name = plugin.display_name;
      const term = search.trim().toLowerCase();
      const isPluginMatch = `${name} ${plugin.description ?? ""}`
        .toLowerCase()
        .includes(term);
      return {
        plugin,
        name,
        isComplete: inspection.isComplete,
        totalTools: tools.length,
        tools: isPluginMatch
          ? tools
          : tools.filter((tool) =>
              `${tool.name} ${tool.description}`.toLowerCase().includes(term),
            ),
        visible:
          isPluginMatch ||
          tools.some((tool) =>
            `${tool.name} ${tool.description}`.toLowerCase().includes(term),
          ),
      };
    })
    .filter((entry) => entry.visible);
  return (
    <section
      className="action-plugin-panel action-card"
      aria-label="Action plugins"
    >
      <div className="action-panel-heading">
        <h3>
          Plugins <span className="count">{assigned.length}</span>
        </h3>
        <WorkspaceLink
          className="action-text-link"
          href={`/plugins/?project=${encodeURIComponent(agent?.id ?? "")}`}
        >
          <Plus size={14} /> {assigned.length > 0 ? "Manage" : "Add plugin"}
        </WorkspaceLink>
      </div>
      {assigned.length > 0 ? (
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <Input
            aria-label="Search plugins or tools"
            placeholder="Search plugins or tools…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
      ) : null}
      <p className="small action-panel-caption">
        {agent
          ? `Available to ${agent.name}`
          : "Choose an agent to see its plugins."}
      </p>
      <ResourceState {...query} />
      {!query.isLoading && !query.error && entries.length === 0 ? (
        <div className="action-empty action-plugin-empty">
          <span className="plugin-empty-symbol">
            <Package size={28} />
          </span>
          <h4>{search ? "No matching tools" : "Add tools to your action"}</h4>
          <p>
            {search
              ? "Try another plugin or tool name."
              : "Explore the marketplace, then assign plugins to this action’s agent to use them in your workflow."}
          </p>
          {search ? null : (
            <WorkspaceLink
              className="button plugin-marketplace-button"
              href="/plugins/"
            >
              <Plus size={15} /> Browse marketplace
            </WorkspaceLink>
          )}
        </div>
      ) : null}
      <div className="action-plugin-list" hidden={entries.length === 0}>
        {entries.map(({ plugin, name, tools, isComplete, totalTools }) => {
          const Icon = pluginIcon(plugin.slug);
          return (
            <details
              className="action-plugin"
              key={`${plugin.id}-${search}`}
              open
            >
              <summary>
                <ChevronDown className="plugin-chevron" size={16} />
                <span className={`plugin-symbol plugin-symbol-${plugin.slug}`}>
                  <Icon size={23} />
                </span>
                <span className="plugin-name">
                  <strong>{name}</strong>
                  <small>
                    {`${String(totalTools)} ${totalTools === 1 ? "tool" : "tools"}${!isComplete && plugin.distribution === "inline" ? " declared" : ""}`}
                  </small>
                </span>
                <span
                  className={`plugin-state ${plugin.enabled ? "is-enabled" : ""}`}
                >
                  <i />
                  {plugin.enabled ? "Enabled" : "Disabled"}
                </span>
              </summary>
              {tools.length > 0 ? (
                <ul className="plugin-tools">
                  {tools.map((tool) => (
                    <li key={tool.name} title={tool.description}>
                      <Braces size={14} />
                      <div>
                        <strong>{tool.name}</strong>
                        {tool.description ? (
                          <p className="small">{tool.description}</p>
                        ) : null}
                        {tool.parameters.length > 0 ? (
                          <p className="small">
                            Parameters:{" "}
                            {tool.parameters
                              .map(
                                (parameter) =>
                                  `${parameter.name}${parameter.optional ? "?" : ""}${parameter.type ? `: ${parameter.type}` : ""}${parameter.description ? ` — ${parameter.description}` : ""}`,
                              )
                              .join("; ")}
                          </p>
                        ) : null}
                        {tool.returnType ? (
                          <p className="small">Returns: {tool.returnType}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small plugin-tool-note">
                  {toolAvailabilityNote(
                    isComplete,
                    plugin.distribution === "inline",
                  )}
                </p>
              )}
              {!isComplete && tools.length > 0 ? (
                <p className="small plugin-tool-note">
                  {plugin.distribution === "inline"
                    ? "Showing statically declared tools. Additional dynamic definitions cannot be listed without running the plugin."
                    : "Showing available tool information. This installed release includes incomplete metadata."}
                </p>
              ) : null}
            </details>
          );
        })}
      </div>
      {assigned.length > 0 ? (
        <WorkspaceLink className="action-catalog-link" href="/plugins/">
          Browse plugin marketplace →
        </WorkspaceLink>
      ) : null}
    </section>
  );
}
