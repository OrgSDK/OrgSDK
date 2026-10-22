"use client";
import { settingsSections } from "./routes";
import { WorkspaceLink } from "./workspace-link";
import { formText } from "../../lib/form-fields";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { result, errorMessage } from "../../api/result";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
const available = [
  { label: "Projects and persistent execution", view: "work" },
  { label: "External clients and saved actions", view: "work" },
  { label: "Versioned TypeScript actions", view: "actions" },
  { label: "Runs, approvals and artifacts", view: "runs" },
  { label: "Scheduled workflows", view: "schedules" },
  { label: "Webhook triggers and delivery health", view: "webhooks" },
  { label: "Custom plugins and credentials", view: "plugins" },
  { label: "MCP and API clients with local activity", view: "connections" },
  { label: "Documents and memory", view: "documents" },
  { label: "Workspace database tables", view: "tables" },
  { label: "Workspace audit log (owners and admins)", view: "audit" },
];
export function Settings({
  workspace,
  role,
  navigate,
  refreshWorkspace,
}: {
  workspace: string;
  role: string;
  navigate: (view: string) => void;
  refreshWorkspace: () => Promise<void>;
}): ReactNode {
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <>
      <section className="panel">
        <h2>Workspace administration</h2>
        <p className="small">
          Manage access, connections and the tools your projects use.
        </p>
        <nav className="settings-navigation" aria-label="Workspace settings">
          {settingsSections.map((item) => (
            <WorkspaceLink
              className="settings-link"
              href={item.href}
              key={item.id}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              <ArrowRight size={15} />
            </WorkspaceLink>
          ))}
        </nav>
      </section>
      <section className="panel">
        <h2>Workspace settings</h2>
        <div className="resource-row">
          <div>
            <strong>{workspace}</strong>
            <small>Your role: {role}</small>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              navigate("members");
            }}
          >
            Manage people
          </Button>
        </div>
        {role === "owner" || role === "admin" ? (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              const name = formText(fields, "workspace-name");
              setSaving(true);
              setError("");
              setNotice("");
              void (async () => {
                try {
                  result(
                    await api.PATCH("/api/v1/workspaces/current/", {
                      body: { name },
                    }),
                  );
                  await refreshWorkspace();
                  setNotice("Workspace name saved.");
                } catch (error_) {
                  setError(errorMessage(error_));
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            <label>
              Workspace name
              <Input
                key={workspace}
                name="workspace-name"
                defaultValue={workspace}
                required
                disabled={isSaving}
              />
            </label>
            <Button type="submit" disabled={isSaving}>
              Save workspace name
            </Button>
          </form>
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
        <p className="small">
          Manage your email address, password and two-factor authentication.
        </p>
        <Button asChild variant="link">
          <a href="/accounts/email/">
            Account settings <ArrowRight size={13} />
          </a>
        </Button>
      </section>
      <section className="panel">
        <h2>Available in this installation</h2>
        {available.map((item) => (
          <div className="resource-row" key={item.label}>
            <CheckCircle2 size={17} />
            <strong>{item.label}</strong>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigate(item.view);
              }}
            >
              Open <ArrowRight size={13} />
            </Button>
          </div>
        ))}
      </section>
    </>
  );
}
