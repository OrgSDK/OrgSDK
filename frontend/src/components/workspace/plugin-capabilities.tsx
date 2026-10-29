"use client";
import { useState, type ReactNode } from "react";
import { pinnedPluginTools } from "../../lib/plugin-tools";
import { Input } from "../ui/input";

export function PluginCapabilities({
  slug,
  metadata,
}: {
  slug: string;
  metadata: unknown;
}): ReactNode {
  const { tools, isComplete } = pinnedPluginTools(metadata);
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tools.filter((tool) =>
    terms.every((term) =>
      `${tool.name} ${tool.description}`.toLowerCase().includes(term),
    ),
  );
  const namespace = slug.replaceAll(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
  return (
    <details className="my-3 min-w-0 rounded-lg border p-3">
      <summary>Capabilities · {tools.length} functions</summary>
      {isComplete ? null : (
        <p className="small">
          Function information is incomplete for this release.
        </p>
      )}
      {tools.length > 0 ? (
        <>
          <label className="my-3 block">
            Find a function
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="Search functions or descriptions"
            />
          </label>
          <p className="small" role="status">
            {matches.length} of {tools.length} functions
          </p>
          <div className="max-h-80 space-y-3 overflow-auto">
            {matches.map((tool) => (
              <details key={tool.name} className="min-w-0 rounded border p-3">
                <summary className="break-words">
                  <code>
                    {namespace}.{tool.name}
                  </code>
                </summary>
                <p className="small my-2">{tool.description}</p>
                <dl className="space-y-2 text-sm">
                  {tool.parameters.map((parameter) => (
                    <div key={parameter.name}>
                      <dt className="break-words font-medium">
                        {parameter.name}
                        {parameter.optional ? " (optional)" : ""}:{" "}
                        <code>{parameter.type}</code>
                      </dt>
                      {parameter.description ? (
                        <dd>{parameter.description}</dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
                {tool.returnType ? (
                  <p className="small mt-2 break-words">
                    Returns: <code>{tool.returnType}</code>
                  </p>
                ) : null}
              </details>
            ))}
          </div>
          {matches.length === 0 ? <p>No matching functions.</p> : null}
        </>
      ) : (
        <p className="small">No functions are declared in this metadata.</p>
      )}
    </details>
  );
}
