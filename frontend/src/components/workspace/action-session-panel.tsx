"use client";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { trpc, type RouterInputs } from "../../api/trpc";
import { errorMessage } from "../../api/result";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useWorkspace } from "./workspace-context";
import { parseActionJSON } from "./action-json";
import { activeStatuses } from "./run-display";

const handleSchema = z.object({
  id: z.uuid(),
  generation: z.number(),
  sequence: z.number(),
});
type Handle = z.output<typeof handleSchema>;
const cellReceipt = z.object({
  cell: z.object({
    sequence: z.number(),
    status: z.string(),
    error: z.string().optional(),
    result: z.unknown().optional(),
  }),
});
const summary = handleSchema.extend({ status: z.string() });
type Request = RouterInputs["runs"]["session"];

export function ActionSessionPanel({
  project,
  action,
  version,
  inputs,
  canRun,
  onRun,
}: {
  project: string;
  action: string | undefined;
  version: number | undefined;
  inputs: string;
  canRun: boolean;
  onRun: (id: string) => void;
}): ReactNode {
  const { sessionStoragePrefix } = useWorkspace();
  const key = sessionStoragePrefix + project;

  const [attachId, setAttachId] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [handle, setHandle] = useState<Handle | undefined>(() => {
    try {
      const value = handleSchema.safeParse(
        JSON.parse(sessionStorage.getItem(key) ?? "null"),
      );
      return value.success ? value.data : undefined;
    } catch {
      return undefined;
    }
  });
  function remember(value?: Handle) {
    setHandle(value);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  }
  async function submit(kind: "open" | "read" | "close" | "cell" | "action") {
    setBusy(true);
    try {
      if (!project) throw new Error("Choose a project.");
      const id = handle?.id ?? attachId.trim();
      let command: Request["session"];
      if (kind === "open") command = { operation: "open" };
      else if (kind === "read" || kind === "close")
        command = { operation: kind, id };
      else {
        if (!handle) throw new Error("Open or attach an execution session.");
        command = {
          operation: "execute",
          id,
          cellId: crypto.randomUUID(),
          generation: handle.generation,
          expectedSequence: handle.sequence,
        };
      }
      const created = await trpc.runs.session.mutate({
        project,
        session: command,
        idempotency_key: crypto.randomUUID(),
        ...(kind === "cell" && { source }),
        ...(kind === "action" && {
          action,
          version,
          inputs: parseActionJSON(inputs),
        }),
      });
      if (kind === "action") onRun(created.id);
      let run = created;
      const deadline = Date.now() + 310_000;
      while (activeStatuses.includes(run.status)) {
        if (Date.now() > deadline)
          throw new Error(
            "This run is still pending. Check run history and refresh the session before continuing.",
          );
        await new Promise((resolve) => setTimeout(resolve, 400));
        run = await trpc.runs.get.query({ id: created.id });
      }
      const output = z
        .object({
          result: z.unknown().optional(),
          session: z.unknown().optional(),
        })
        .parse(run.output);
      if (kind === "cell" || kind === "action") {
        const receipt = cellReceipt.safeParse(
          kind === "action" ? output.session : output.result,
        );
        if (handle && receipt.success) {
          remember({ ...handle, sequence: receipt.data.cell.sequence });
          if (receipt.data.cell.status !== "succeeded")
            throw new Error(receipt.data.cell.error ?? "Cell failed.");
          if (run.status !== "succeeded")
            throw new Error(run.error || "Run failed.");
          setMessage(JSON.stringify(receipt.data.cell.result ?? null));
          return;
        }
      }
      if (run.status !== "succeeded")
        throw new Error(run.error || "Session operation failed.");
      const state = summary.parse(output.result);
      if (["closed", "expired", "lost"].includes(state.status)) remember();
      else remember(state);
      setMessage("Session " + state.status + ".");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {handle ? (
          <>
            <span>
              Session {handle.id} · Cell {handle.sequence}
            </span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void submit("read")}
            >
              Refresh session
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void submit("close")}
            >
              Close session
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={busy || !project}
              onClick={() => void submit("open")}
            >
              Open session
            </Button>
            <Input
              aria-label="Existing session ID"
              placeholder="Existing session ID"
              value={attachId}
              onChange={(event) => {
                setAttachId(event.target.value);
              }}
            />
            <Button
              variant="outline"
              disabled={busy || !z.uuid().safeParse(attachId.trim()).success}
              onClick={() => void submit("read")}
            >
              Attach session
            </Button>
          </>
        )}
      </div>
      {handle && (
        <>
          <Button
            disabled={busy || !canRun}
            onClick={() => void submit("action")}
          >
            Run selected version in session
          </Button>
          <label>
            TypeScript cell
            <Textarea
              className="code"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
              }}
              spellCheck={false}
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || !source.trim()}
            onClick={() => void submit("cell")}
          >
            Execute cell
          </Button>
        </>
      )}
      <output
        className="block whitespace-pre-wrap break-words"
        aria-live="polite"
      >
        {busy ? "Running…" : message}
      </output>
    </div>
  );
}
