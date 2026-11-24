"use client";
import { useCallback, useState, type ReactNode } from "react";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { useWorkspaceQuery } from "../../api/use-workspace-query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ResourceState } from "./resource-state";

export function ShellPolicy({
  id,
  canManage,
}: {
  id: string;
  canManage: boolean;
}): ReactNode {
  const load = useCallback(
    (signal: AbortSignal) => trpc.plugins.shellRules.query({ id }, { signal }),
    [id],
  );
  const query = useWorkspaceQuery(load, 5000);
  const [name, setName] = useState("");
  const [decision, setDecision] = useState<"allow" | "block">("allow");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(executable: string, rule: "allow" | "block" | "ask") {
    setBusy(true);
    setError("");
    try {
      await trpc.plugins.setShellRule.mutate({
        id,
        executable,
        decision: rule,
      });
      await query.refresh();
      setName("");
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Executable policy">
      <h3>Executable policy</h3>
      <p>
        Unlisted commands pause the run for approval. Each saved rule applies to
        that exact name and all its arguments in this project.
      </p>
      <ResourceState {...query} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {query.data?.map((rule) => (
        <div className="row" key={rule.executable}>
          <code>{rule.executable}</code>
          <span>
            {rule.decision === "allow" ? "Always allowed" : "Blocked"}
          </span>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void save(rule.executable, "ask")}
              aria-label={`Ask next time for ${rule.executable}`}
            >
              Ask next time
            </Button>
          )}
        </div>
      ))}
      {canManage && (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void save(name, decision);
          }}
        >
          <label>
            Executable name
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
              maxLength={128}
              placeholder="uptime"
              disabled={busy}
            />
          </label>
          <label>
            Rule
            <select
              value={decision}
              onChange={(event) => {
                setDecision(event.target.value === "block" ? "block" : "allow");
              }}
              disabled={busy}
            >
              <option value="allow">Always allow</option>
              <option value="block">Block</option>
            </select>
          </label>
          <Button type="submit" disabled={busy || !name}>
            Save rule
          </Button>
        </form>
      )}
    </section>
  );
}
