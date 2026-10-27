"use client";
import { useState, type ReactNode } from "react";
import { parseActionJSON } from "./action-json";
import { api } from "../../api/client";
import { result, errorMessage } from "../../api/result";
import { WorkspaceLink } from "./workspace-link";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
export function RunPromotion({ id }: { id: string }): ReactNode {
  const [name, setName] = useState("");
  const [inputSchema, setInputSchema] = useState('{"type":"object"}');
  const [outputSchema, setOutputSchema] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedAction, setSavedAction] = useState("");
  const [error, setError] = useState("");
  async function promote(): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = result(
        await api.POST("/api/v1/runs/{id}/promote/", {
          params: { path: { id } },
          body: {
            name: name.trim(),
            input_schema: parseActionJSON(inputSchema),
            output_schema: parseActionJSON(outputSchema),
          },
        }),
      );
      setSavedAction(saved.action);
      setMessage(
        `Saved exact run source as version ${String(saved.version.number)} of ${name.trim()} (action ${saved.action}).`,
      );
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Promote accepted source to a saved action</summary>
      <p>
        The server copies this run’s exact source and SDK provenance. Run inputs
        remain examples and are not saved as defaults.
      </p>
      <label>
        New action name
        <Input
          value={name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label>
        Input schema (JSON)
        <Textarea
          className="code"
          value={inputSchema}
          disabled={busy}
          onChange={(event) => {
            setInputSchema(event.target.value);
          }}
        />
      </label>
      <label>
        Output schema (JSON)
        <Textarea
          className="code"
          value={outputSchema}
          disabled={busy}
          onChange={(event) => {
            setOutputSchema(event.target.value);
          }}
        />
      </label>
      <Button
        disabled={busy || !name.trim()}
        onClick={() => {
          void promote();
        }}
      >
        Promote exact source
      </Button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {savedAction ? (
        <WorkspaceLink
          href={`/actions/?action=${encodeURIComponent(savedAction)}`}
        >
          Open saved action
        </WorkspaceLink>
      ) : null}
    </details>
  );
}
