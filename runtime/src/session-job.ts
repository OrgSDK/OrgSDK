import { SessionBrowser } from "./session-browser";
import { actionBody } from "./action-execution";
import { validateCode } from "./validate-code";
import { join } from "node:path";
import { z } from "zod";
import { Client, type RunCompletion } from "./client";
import { withRetry } from "./engine/retry";
import type { Job, Plugin } from "./contract";
import type { SessionFunction, SessionHistory } from "./sessions";
import { SessionManager } from "./sessions";
import { MAX_VALUE_BYTES } from "./sessions/values";
import { spawnJob } from "./spawn-job";

const sdkPluginSchema = z.object({
  slug: z.string(),
  available: z.literal(true),
  namespace: z.string(),
  tools: z.array(z.object({ name: z.string(), calling: z.literal("named") })),
});
const sdkSchema = z.object({ plugins: z.array(z.unknown()) });
const heartbeatSchema = z.object({
  cancel_requested: z.boolean(),
  status: z.string(),
});
const toolOutputSchema = z.object({ result: z.json() });
const agentVolume = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);

export class SessionJobs {
  private readonly manager: SessionManager;
  private authority?: { job: Job; check: () => Promise<void> };
  private browser?: SessionBrowser;
  private activePluginCalls = 0;

  constructor(
    private readonly options: {
      base: string;
      agentId: string;
      directory: string;
      mode: "docker" | "host";
    },
  ) {
    const { agentId, directory, mode } = options;
    const volume =
      mode === "docker" && process.env.EXECUTOR_DATA_BIND !== "1"
        ? {
            name: agentVolume.parse(process.env.EXECUTOR_DATA_VOLUME),
            subpath: `agents/${agentId}/workspace`,
          }
        : undefined;
    this.manager = new SessionManager({
      mode,
      historyDirectory: join(directory, "..", "..", "session-history", agentId),
      image: process.env.EXECUTOR_IMAGE,
      sourceDirectory: process.env.EXECUTOR_SOURCE_DIR,
      workspaceVolume: volume,
      onGenerationEnd: async () => {
        const browser = this.browser;
        this.browser = undefined;
        await browser?.close();
      },
    });
  }

  private functions(job: Job): SessionFunction[] {
    const plugins =
      job.snapshot.agents.find((entry) => entry.id === this.options.agentId)
        ?.plugins ?? [];
    const sdk = sdkSchema.parse(job.snapshot.sdk);
    return sdk.plugins.flatMap((entry) => {
      const parsed = sdkPluginSchema.safeParse(entry);
      if (!parsed.success) return [];
      const metadata = parsed.data;
      const plugin = plugins.find((item) => item.slug === metadata.slug);
      if (
        plugin?.distribution !== "mcp" &&
        plugin?.distribution !== "external"
      ) {
        return [];
      }
      return metadata.tools.map((tool) => ({
        name: `${metadata.namespace}.${tool.name}`,
        handler: (args, context) => {
          if (!context.capability)
            throw new Error("Missing active cell authority");
          return this.pluginCall(
            plugin,
            tool.name,
            args,
            context.capability,
            context.signal,
          );
        },
      }));
    });
  }

  private async pluginCall(
    plugin: Plugin,
    name: string,
    args: unknown[],
    capability: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const authority = this.authority;
    if (authority?.job.capability !== capability) {
      throw new Error("Missing active cell authority");
    }
    if (this.activePluginCalls >= 4) {
      throw new Error(
        "At most four plugin calls may run concurrently in a cell",
      );
    }
    this.activePluginCalls++;
    try {
      await authority.check();
      signal.throwIfAborted();
      return await this.invokePlugin(plugin, name, args, capability, signal);
    } finally {
      this.activePluginCalls--;
    }
  }

  private async invokePlugin(
    plugin: Plugin,
    name: string,
    args: unknown[],
    capability: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (args.length > 1) {
      throw new Error(
        "Plugin functions accept a single named arguments object",
      );
    }
    const input = z
      .record(z.string(), z.json())
      .parse(args.length ? args[0] : {});
    if (
      plugin.slug === "playwright-local" &&
      plugin.distribution === "external" &&
      !plugin.credential_id
    ) {
      this.browser ??= new SessionBrowser(
        {
          ...this.options,
          name: `orgsdk-session-browser-${crypto.randomUUID()}`,
        },
        plugin,
      );
      return this.browser.call(name, input, signal);
    }
    const { child, kill } = spawnJob(
      { ...this.options, name: `orgsdk-session-tool-${crypto.randomUUID()}` },
      "pipe",
    );
    signal.addEventListener("abort", kill, { once: true });
    const exited = child.exited.catch(() => 1);
    try {
      child.stdin.end(
        JSON.stringify({
          type: "session_plugin_call",
          agentId: this.options.agentId,
          capability,
          plugin,
          name,
          args: input,
        }),
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of child.stdout) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_VALUE_BYTES + 1024) {
          throw new Error("Plugin function output exceeds session limit");
        }
        chunks.push(buffer);
      }
      const code = await exited;
      signal.throwIfAborted();
      if (code !== 0)
        throw new Error(`Plugin function ${plugin.slug}.${name} failed`);
      const output = Buffer.concat(chunks).toString("utf8").trim();
      return toolOutputSchema.parse(JSON.parse(output.split("\n").at(-1) ?? ""))
        .result;
    } finally {
      signal.removeEventListener("abort", kill);
      kill();
      await exited;
    }
  }

  private summary(history: SessionHistory) {
    return {
      id: history.id,
      generation: history.generation,
      status: history.status,
      cursor: history.cursor,
      sequence: history.cells.length,
      worker: history.worker,
    };
  }

  private async execute(job: Job, signal: AbortSignal): Promise<unknown> {
    const { session: command, session_scope: scope } = job.snapshot;
    if (!command || !scope) throw new Error("Invalid session command");
    const workspaceDirectory = join(this.options.directory, "workspace");
    const revision = z
      .string()
      .min(1)
      .parse(job.snapshot.configuration_revision);
    signal.throwIfAborted();
    switch (command.operation) {
      case "open": {
        const history = await this.manager.open({
          ...scope,
          workspaceDirectory,
          configurationRevision: revision,
          functions: this.functions(job),
        });
        if (signal.aborted) {
          await this.manager.close(history.id, scope);
          signal.throwIfAborted();
        }
        return this.summary(history);
      }
      case "execute": {
        const source = z.string().parse(job.snapshot.source);
        const actionVersionId = job.snapshot.action_version_id;
        const actionSource = actionVersionId
          ? actionBody(source, job.snapshot.execution)
          : undefined;
        if (
          actionSource !== undefined &&
          job.snapshot.validation_mode === "semantic"
        ) {
          const validation = validateCode(actionSource, job.snapshot.sdk);
          if (!validation.valid)
            throw new Error(
              validation.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("\n"),
            );
        }
        const reply = await this.manager.execute(command.id, scope, {
          id: command.cellId,
          generation: command.generation,
          expectedSequence: command.expectedSequence,
          after: command.after,
          source,
          ...(actionSource !== undefined && {
            actionVersionId,
            runId: job.run_id,
            executionSource: `return await (async () => {\n${actionSource}\n})();`,
            outputSchema: job.snapshot.output_schema,
          }),
          inputs: job.inputs,
          capability: job.capability,
          configurationRevision: revision,
          signal,
          limit: 10,
          timeoutMs: Math.max(
            1,
            Math.min(300_000, Date.parse(job.deadline) - Date.now()),
          ),
        });
        const { cell, ...page } = reply;
        const { source: _source, inputs: _inputs, ...result } = cell;
        return { ...page, cell: result };
      }
      case "read": {
        const history = await this.manager.inspect(command.id, scope);
        const page = await this.manager.readEvents(command.id, scope, {
          after: command.after,
          limit: command.limit ?? 10,
        });
        return { ...this.summary(history), ...page };
      }
      case "close":
        return this.summary(await this.manager.close(command.id, scope));
    }
  }

  async run(job: Job, parentSignal: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    const client = new Client(this.options.base, job.capability, parentSignal);
    const check = async () => {
      try {
        const state = heartbeatSchema.parse(await client.heartbeat(job.run_id));
        if (state.cancel_requested || state.status !== "running")
          controller.abort();
      } catch {
        controller.abort();
      }
    };
    const timer = setInterval(() => void check(), 5000);
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(0, Date.parse(job.deadline) - Date.now()),
    );
    this.authority = { job, check };
    try {
      let completion: RunCompletion;
      try {
        await check();
        const output = await this.execute(job, signal);
        signal.throwIfAborted();
        if (job.snapshot.action_version_id) {
          const receipt = z
            .object({
              cell: z.object({
                status: z.string(),
                result: z.unknown(),
                error: z.string().optional(),
              }),
            })
            .parse(output);
          completion = {
            status:
              receipt.cell.status === "succeeded" ? "succeeded" : "failed",
            output: { result: receipt.cell.result ?? null, session: output },
            ...(receipt.cell.error && { error: receipt.cell.error }),
          };
        } else completion = { status: "succeeded", output: { result: output } };
      } catch (error) {
        completion = {
          status: signal.aborted ? "cancelled" : "failed",
          error:
            error instanceof Error ? error.message : "Session operation failed",
        };
      }
      // The server accepts duplicate completions only when their bodies agree.
      // A transport failure must not turn a locally completed cell into a failure.
      await withRetry(() => client.complete(job.run_id, completion), {
        maxRetries: 2,
        initialDelayMs: 200,
        shouldRetry: (error) =>
          !parentSignal.aborted && !/^API 4(?!29)\d\d:/.test(error.message),
      });
    } catch (error) {
      // This capability belongs to one run. A delivery error must leave the
      // project registration available for the next claim.
      if (!parentSignal.aborted) {
        console.error(
          `Session run ${job.run_id} completion was not acknowledged:`,
          error instanceof Error ? error.message : "Unknown transport error",
        );
      }
    } finally {
      this.authority = undefined;
      clearTimeout(deadline);
      clearInterval(timer);
    }
  }

  dispose(): Promise<void> {
    return this.manager.dispose();
  }
}
