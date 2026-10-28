"use client";
import type { Action, ActionVersion } from "../../api/types";
import { useEffect, useState, type ReactNode } from "react";
import { parseActionJSON, parseActionCases } from "./action-json";
import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { trpc } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useRunDetail } from "./use-run-detail";
import { ActionCheckReport } from "./action-check-report";
import { RunStatus } from "./run-display";

function CheckResult({ id }: { id: string }): ReactNode {
  const query = useRunDetail(id);
  return (
    <div aria-live="polite">
      {query.error ? <p role="alert">{query.error}</p> : null}
      {query.data ? (
        <>
          <p>
            {query.data.run.operation === "test"
              ? "Mocked tests"
              : "Semantic validation"}{" "}
            <RunStatus status={query.data.run.status} />
          </p>
          {query.data.run.error ? (
            <p role="alert">{query.data.run.error}</p>
          ) : null}
          <ActionCheckReport output={query.data.run.output} />
        </>
      ) : (
        <p>Loading check…</p>
      )}
    </div>
  );
}
function isMissingSuite(error: unknown): boolean {
  const details: unknown =
    error instanceof TRPCClientError ? error.data : undefined;
  return z.object({ code: z.literal("NOT_FOUND") }).safeParse(details).success;
}
export function ActionChecks({
  project,
  action,
  version,
  source,
  inputSchema,
  outputSchema,
  dirty,
  onDirtyChange,
}: {
  project: string;
  action: Action | undefined;
  version: ActionVersion | undefined;
  source: string;
  inputSchema: string;
  outputSchema: string;
  dirty: boolean;
  onDirtyChange: (isDirty: boolean) => void;
}): ReactNode {
  const [cases, setCases] = useState(
    '[\n  {"name":"example", "inputs":{}, "expected":null, "mocks":[], "forbidden_calls":[]}\n]',
  );
  const [savedCases, setSavedCases] = useState("");
  const [revision, setRevision] = useState<number>();
  const [loading, setLoading] = useState(!!version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runId, setRunId] = useState("");
  useEffect(() => {
    if (!action || !version) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const suite = await trpc.actions.tests.query(
          { id: action.id, version: version.number },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const text = JSON.stringify(suite.cases, null, 2);
        setCases(text);
        setSavedCases(text);
        setRevision(suite.revision);
      } catch (error_) {
        if (!controller.signal.aborted && !isMissingSuite(error_)) {
          setError(errorMessage(error_));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [action, version]);
  async function perform(
    operation: "validate" | "save" | "test",
  ): Promise<void> {
    setBusy(true);
    setError("");
    try {
      if (operation === "validate") {
        const run = await trpc.actions.validateCode.mutate({
          project,
          source,
          input_schema: parseActionJSON(inputSchema),
          output_schema: parseActionJSON(outputSchema),
          idempotency_key: crypto.randomUUID(),
        });
        setRunId(run.id);
        return;
      }
      if (!action || !version || dirty)
        throw new Error(
          "Save the source version before editing or running its tests.",
        );
      if (operation === "save") {
        const suite = await trpc.actions.saveTests.mutate({
          id: action.id,
          version: version.number,
          cases: parseActionCases(cases),
        });
        setRevision(suite.revision);
        setSavedCases(cases);
        onDirtyChange(false);
        return;
      }
      if (revision === undefined || cases !== savedCases)
        throw new Error("Save the test suite before running it.");
      const run = await trpc.actions.runTests.mutate({
        id: action.id,
        version: version.number,
        suite_revision: revision,
        idempotency_key: crypto.randomUUID(),
      });
      setRunId(run.id);
    } catch (error_) {
      setError(errorMessage(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Validation and mocked tests">
      <h3>Validation and mocked tests</h3>
      <Button
        variant="outline"
        disabled={busy || !project || !source.trim()}
        onClick={() => {
          void perform("validate");
        }}
      >
        Validate source
      </Button>
      <p className="small">
        Semantic validation checks this editor’s source and both contracts
        against the project SDK. It executes no integrations.
      </p>
      {version ? (
        <>
          <h4>
            Version {version.number} ·{" "}
            {revision === undefined
              ? "No saved test suite"
              : `Test suite revision ${String(revision)}`}
          </h4>
          <p className="small">
            Mocked tests run in isolation without network, project files or live
            credentials. Mocks declare expected calls; unexpected calls fail.
          </p>
          <label>
            Test cases (JSON)
            <Textarea
              className="code"
              rows={12}
              value={cases}
              disabled={loading || busy || dirty}
              onChange={(event) => {
                setCases(event.target.value);
                onDirtyChange(event.target.value !== savedCases);
              }}
            />
          </label>
          <div className="row">
            <Button
              variant="outline"
              disabled={loading || busy || dirty}
              onClick={() => {
                void perform("save");
              }}
            >
              Save test suite revision
            </Button>
            <Button
              disabled={
                loading ||
                busy ||
                dirty ||
                revision === undefined ||
                cases !== savedCases
              }
              onClick={() => {
                void perform("test");
              }}
            >
              Run mocked tests
            </Button>
          </div>
          {dirty ? (
            <p>Save a new source version before saving its tests.</p>
          ) : null}
        </>
      ) : (
        <p>Save a source version to add mocked regression tests.</p>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {runId ? <CheckResult key={runId} id={runId} /> : null}
    </section>
  );
}
