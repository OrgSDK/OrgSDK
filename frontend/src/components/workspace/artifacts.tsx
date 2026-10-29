"use client";
import { Download, FileText, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { loadArtifacts } from "../../api/workspace-queries";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MarkdownContent } from "../markdown-content";
import { ResourceState } from "./resource-state";
import { downloadArtifact } from "./run-detail";
export function Artifacts({
  openRun,
}: {
  openRun: (id: string) => void;
}): ReactNode {
  const query = useWorkspaceQuery(loadArtifacts);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const artifacts =
    query.data?.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const artifact = query.data?.find((item) => item.id === selected);
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>Saved artifacts</h2>
          <span className="badge">{query.data?.length ?? 0} files</span>
        </div>
        <p className="small">
          Markdown, JSON and text produced by your projects and actions.
        </p>
        <label className="search-field">
          <Search size={15} />
          <Input
            aria-label="Search artifacts"
            value={search}
            placeholder="Search files…"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <ResourceState {...query} />
        {!query.isLoading && artifacts.length === 0 ? (
          <div className="resource-empty">
            <FileText size={30} />
            <h3>No artifacts found</h3>
            <p>Files saved during runs appear here.</p>
          </div>
        ) : undefined}
        {artifacts.map((item) => (
          <div className="resource-row" key={item.id}>
            <FileText size={18} />
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.media_type} · {new Blob([item.content]).size} bytes
              </small>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(item.id);
              }}
            >
              Open
            </Button>
          </div>
        ))}
      </section>
      {artifact ? (
        <section className="panel">
          <div className="panel-title">
            <h2>{artifact.name}</h2>
            <div className="row">
              <Button
                variant="outline"
                onClick={() => {
                  openRun(artifact.run);
                }}
              >
                View producing run
              </Button>
              <Button
                onClick={() => {
                  downloadArtifact(artifact);
                }}
              >
                <Download size={14} />
                Download
              </Button>
            </div>
          </div>
          {artifact.media_type.includes("markdown") ||
          artifact.name.endsWith(".md") ? (
            <MarkdownContent content={artifact.content} />
          ) : (
            <pre>{artifact.content}</pre>
          )}
        </section>
      ) : undefined}
    </>
  );
}
