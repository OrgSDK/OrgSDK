import {
  spawnProcess,
  stopHostProcess,
  workerCommand,
} from "../process-runtime";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { errorText, jsonValue } from "./values";
import { SessionError, type CellEvaluation } from "./types";

export interface SessionProcessOptions {
  id: string;
  generation: number;
  mode: "host" | "docker";
  workspaceDirectory: string;
  image?: string;
  sourceDirectory?: string;
}

export function sessionCommand(options: SessionProcessOptions): string[] {
  if (options.mode === "host")
    return workerCommand(import.meta.url, "./worker");
  for (const path of [
    options.workspaceDirectory,
    options.sourceDirectory,
  ].filter((path): path is string => path !== undefined))
    if (!isAbsolute(path) || /[,\r\n]/.test(path))
      throw new Error(
        "Session mount paths must be absolute without commas or newlines",
      );
  return [
    "docker",
    "run",
    "--rm",
    "-i",
    "--name",
    `orgsdk-session-${options.id}-${options.generation}`,
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=128m",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=128",
    "--memory=512m",
    "--cpus=1",
    "--user",
    `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
    "--mount",
    `type=bind,src=${options.workspaceDirectory},dst=/project/workspace`,
    ...(options.sourceDirectory
      ? [
          "--mount",
          `type=bind,src=${options.sourceDirectory},dst=/executor/src,readonly`,
        ]
      : []),
    "--workdir",
    "/project/workspace",
    "--entrypoint",
    "bun",
    options.image ?? process.env.EXECUTOR_IMAGE ?? "orgsdk-job:dev",
    "--no-env-file",
    "/executor/src/sessions/worker.ts",
  ];
}

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("result"),
    requestId: z.string(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("event"),
    cellId: z.string(),
    kind: z.enum(["execution.log", "execution.step"]),
    data: z.unknown(),
  }),
  z.object({
    type: z.literal("call"),
    callId: z.string(),
    cellId: z.string(),
    name: z.string(),
    args: z.array(z.unknown()),
  }),
]);

export class SessionProcess {
  private readonly child;
  private readonly reading: Promise<void>;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private stopped?: Promise<void>;
  private failure?: Error;

  constructor(
    private readonly options: SessionProcessOptions,
    hooks: {
      event: (cellId: string, kind: string, data: unknown) => void;
      call: (cellId: string, name: string, args: unknown[]) => Promise<unknown>;
      exit: () => void;
    },
  ) {
    const child = spawnProcess(sessionCommand(options), {
      cwd: options.workspaceDirectory,
      detached: options.mode === "host" && process.platform !== "win32",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: options.mode === "host" ? options.workspaceDirectory : "/tmp",
      },
      stdout: "pipe",
      stderr: "ignore",
    });
    this.child = child;
    this.reading = (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of child.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffer) > 1_000_000)
          throw new Error("Session worker output exceeds limit");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const message = messageSchema.parse(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
          if (message.type === "result") {
            const pending = this.pending.get(message.requestId);
            this.pending.delete(message.requestId);
            if (message.error) pending?.reject(new Error(message.error));
            else pending?.resolve(message.value);
          } else if (message.type === "event")
            hooks.event(message.cellId, message.kind, message.data);
          else
            void hooks
              .call(message.cellId, message.name, message.args)
              .then((value) => jsonValue(value))
              .then(
                (value) =>
                  this.send({
                    type: "toolResult",
                    callId: message.callId,
                    value,
                  }),
                (error) =>
                  this.send({
                    type: "toolResult",
                    callId: message.callId,
                    error: errorText(error),
                  }),
              )
              .catch(() => undefined);
        }
      }
    })().catch(() => {
      void this.stop().catch(() => undefined);
    });
    const finished = async (error?: unknown) => {
      this.failure =
        error instanceof Error ? error : new Error("Session worker exited");
      await this.reading;
      for (const pending of this.pending.values()) pending.reject(this.failure);
      this.pending.clear();
      hooks.exit();
    };
    void this.child.exited
      .then(() => finished(), finished)
      .catch(() => undefined);
  }

  private send(message: unknown): void {
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  private request(
    type: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this.pending.set(requestId, { resolve, reject });
      try {
        this.send({ ...data, type, requestId });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async initialize(
    functions: string[],
    timeoutMs = 30_000,
  ): Promise<{ pid: number; hostname: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const identity = await Promise.race([
        this.request("initialize", { functions }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new SessionError(
                  "startup_timeout",
                  "Session worker startup timed out",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
      return z
        .object({ pid: z.number().int(), hostname: z.string() })
        .parse(identity);
    } finally {
      clearTimeout(timer);
    }
  }

  async execute(
    cellId: string,
    source: string,
    inputs: Record<string, unknown>,
  ): Promise<CellEvaluation> {
    return (await this.request("execute", {
      cellId,
      source,
      inputs,
    })) as CellEvaluation;
  }

  stop(): Promise<void> {
    this.stopped ??= (async () => {
      if (this.options.mode === "docker") {
        await spawnProcess(
          [
            "docker",
            "rm",
            "-f",
            `orgsdk-session-${this.options.id}-${this.options.generation}`,
          ],
          { stdout: "ignore", stderr: "ignore" },
        ).exited.catch(() => undefined);
        this.child.kill("SIGKILL");
      } else stopHostProcess(this.child);
      await this.child.exited.catch(() => undefined);
      await this.reading;
    })();
    return this.stopped;
  }
}
