import { validateCode } from "./validate-code";
import { join } from "node:path";
import { projectDataFunctions } from "./project-data";
import { projectFileFunctions } from "./project-files";
import { z } from "zod";
import type { Agent, Job } from "./contract";
import { Client } from "./client";
import { SandboxExecutor } from "./engine/sandbox/executor";
import type { SandboxFunction } from "./engine/sandbox/types";
import { loadPlugins } from "./plugins";

import {
  TRACE_LIMIT,
  TRACE_QUEUE_BYTES,
  TRACE_TRUNCATION_RESERVE_BYTES,
  traceValue,
} from "./engine/sandbox/trace";

const record = z.record(z.string(), z.unknown());
const approvalSchema = z.object({ id: z.string(), status: z.string() });

export class Runner {
  private sequence = 0;
  private events = Promise.resolve();
  constructor(
    private job: Job,
    private client: Client,
    private signal: AbortSignal,
    private executionRoot = process.env.EXECUTOR_AGENT_DIR
      ? join(process.env.EXECUTOR_AGENT_DIR, "workspace")
      : undefined,
  ) {}

  async event(kind: string, data: unknown): Promise<void> {
    const pending = this.events
      .then(() =>
        this.client.request(
          `/internal/execution/v1/runs/${this.job.run_id}/events/`,
          "POST",
          { sequence: ++this.sequence, kind, data },
        ),
      )
      .then(() => undefined);
    this.events = pending.catch(() => undefined);
    return pending;
  }

  private async approval(prompt: string): Promise<boolean> {
    let approval = approvalSchema.parse(
      await this.client.product("approvals/", "POST", {
        run: this.job.run_id,
        prompt,
      }),
    );
    await this.event("approval.requested", {
      approval_id: approval.id,
      prompt,
    });
    while (approval.status === "pending") {
      this.signal.throwIfAborted();
      await Bun.sleep(1000);
      approval = approvalSchema.parse(
        await this.client.product(`approvals/${approval.id}/`),
      );
    }
    if (approval.status !== "approved")
      throw new Error("Approval denied or interrupted");
    return true;
  }

  private builtins(agent: Agent): SandboxFunction[] {
    let fileFunctions: SandboxFunction[] | undefined;
    const files = ["readFile", "writeFile", "listFiles", "removeFile"].map(
      (name): SandboxFunction => ({
        name,
        calling: "positional",
        handler: (...args: unknown[]) => {
          if (!this.executionRoot)
            throw new Error(
              "Persistent files require EXECUTOR_AGENT_DIR to be configured for this agent",
            );
          fileFunctions ??= projectFileFunctions(
            this.executionRoot,
            this.signal,
          );
          return fileFunctions.find((fn) => fn.name === name)!.handler(...args);
        },
      }),
    );
    return [
      ...files,
      ...projectDataFunctions(this.client, this.signal),
      {
        name: "requestApproval",
        calling: "positional",
        handler: (prompt: unknown) => this.approval(z.string().parse(prompt)),
      },
      {
        name: "saveArtifact",
        calling: "positional",
        handler: (name: unknown, content: unknown) =>
          this.client.product("artifacts/", "POST", {
            run: this.job.run_id,
            name: z.string().parse(name),
            content: z.string().parse(content),
          }),
      },
      ...(agent.resources === undefined && this.job.operation !== "code"
        ? [
            {
              name: "saveMemory",
              calling: "positional",
              handler: (title: unknown, content: unknown) =>
                this.client.product("documents/", "POST", {
                  kind: "memory",
                  title: z.string().parse(title),
                  content: z.string().parse(content),
                }),
            } satisfies SandboxFunction,
          ]
        : []),
      {
        name: "delegate",
        calling: "positional",
        handler: () => {
          throw new Error(
            "Unsupported operation: built-in reasoning delegation has been retired",
          );
        },
      },
    ];
  }

  private agent(id: string): Agent {
    const found = this.job.snapshot.agents.find((agent) => agent.id === id);
    if (!found) throw new Error("Agent outside run snapshot");
    return found;
  }

  async action(
    agent: Agent,
    source: string,
    inputs: Record<string, unknown>,
  ): Promise<unknown> {
    this.signal.throwIfAborted();
    if (this.job.snapshot.validation_mode === "semantic") {
      const validation = validateCode(source, this.job.snapshot.sdk);
      if (!validation.valid)
        throw new Error(
          `Semantic validation failed: ${JSON.stringify(validation.diagnostics)}`,
        );
    }
    const executor = new SandboxExecutor();
    executor.registerBuiltins(this.builtins(agent));
    executor.registerMultiple(
      await loadPlugins(agent.plugins, this.client, agent.id),
    );
    let pending = Promise.resolve();
    let eventCount = 0;
    let eventBytes = 0;
    let accepting = true;
    let truncated = false;
    const append = (kind: string, data: Record<string, unknown>) => {
      eventCount++;
      eventBytes += new TextEncoder().encode(JSON.stringify(data)).length;
      pending = pending
        .then(async () => {
          if (!accepting || this.signal.aborted) return;
          await this.event(kind, data);
        })
        .catch(() => undefined);
    };
    const markTruncated = () => {
      if (truncated || !accepting) return;
      truncated = true;
      append("execution.truncated", {
        agent_id: agent.id,
        truncated: true,
        reason: "Trace retention limit reached",
      });
    };
    const enqueue = (kind: string, value: unknown) => {
      if (!accepting) return;
      const payload = traceValue(value);
      const data: Record<string, unknown> =
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload)
          ? { ...record.parse(payload), agent_id: agent.id }
          : { agent_id: agent.id, truncated: true, payload };
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
      if (
        eventCount >= TRACE_LIMIT - 1 ||
        eventBytes + bytes > TRACE_QUEUE_BYTES - TRACE_TRUNCATION_RESERVE_BYTES
      ) {
        markTruncated();
        return;
      }
      append(kind, data);
    };
    try {
      const result = await executor.execute(
        source,
        { agent, stores: {}, actionRunner: {}, runId: this.job.run_id },
        {
          timeout: 300_000,
          parameters: inputs,
          signal: this.signal,
          onLog: (line) => enqueue("execution.log", { message: line }),
          onTraceTruncated: markTruncated,
          onStep: (step) => enqueue("execution.step", step),
        },
      );
      enqueue("action.result", {
        logs: result.logs,
        steps: result.steps,
        duration_ms: result.durationMs,
      });
      const output = result.result ?? null;
      return output;
    } finally {
      // A failed/cancelled run must not wait for a full queue of slow HTTP calls.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        await Promise.race([
          pending,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 2000);
            onAbort = resolve;
            this.signal.addEventListener("abort", onAbort, { once: true });
            if (this.signal.aborted) resolve();
          }),
        ]);
      } finally {
        clearTimeout(timer);
        if (onAbort) this.signal.removeEventListener("abort", onAbort);
        accepting = false;
      }
    }
  }

  async run(): Promise<unknown> {
    if (["validate", "test"].includes(this.job.operation))
      throw new Error(
        "Validation and test jobs require the isolated Docker worker",
      );
    if (this.job.operation === "chat")
      throw new Error(
        "Unsupported operation: built-in chat has been retired; use external-client code or actions",
      );
    const agent = this.agent(this.job.snapshot.root_agent_id);
    return this.action(
      agent,
      z.string().parse(this.job.snapshot.source),
      this.job.inputs,
    );
  }
}
