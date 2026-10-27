import { runIsolatedJob } from "./isolated-actions";
import { chown } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { z } from "zod";
import { Client } from "./client";
import { jobSchema, pluginSchema } from "./contract";
import {
  agentDirectory,
  installPlugin,
  safeSegment,
  safeDirectory,
} from "./plugin-store";

export const registrationSchema = z.object({
  agent_id: z.string(),
  executor_id: z.string().optional(),
  token: z.string().min(32),
});
export type Registration = z.infer<typeof registrationSchema>;
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

export function developmentSourceArguments(
  source = process.env.EXECUTOR_SOURCE_DIR,
): string[] {
  if (!source) return [];
  if (!isAbsolute(source) || /[,\n\r]/.test(source))
    throw new Error(
      "EXECUTOR_SOURCE_DIR must be an absolute host path without commas or newlines",
    );
  return ["--mount", `type=bind,src=${source},dst=/executor/src,readonly`];
}

export function agentMountArguments(
  agentId: string,
  directory: string,
): string[] {
  if (process.env.EXECUTOR_DATA_BIND === "1") {
    if (!isAbsolute(directory) || /[,\n\r]/.test(directory))
      throw new Error(
        "Agent bind directory must be absolute without commas or newlines",
      );
    return ["--mount", `type=bind,src=${directory},dst=/agent`];
  }
  return [
    "--mount",
    `type=volume,src=${z.string().min(1).parse(process.env.EXECUTOR_DATA_VOLUME)},dst=/agent,volume-subpath=agents/${safeSegment(agentId)}`,
  ];
}

export function jobEnvironment(
  base: string,
  agentPath: string,
  host: boolean,
): Record<string, string> {
  const inherited = host
    ? Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value !== undefined &&
            !/(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|BOOTSTRAP)/i.test(key),
        ),
      )
    : {};
  return {
    ...inherited,
    PATH: process.env.PATH || "",
    HOME: host ? process.env.HOME || agentPath : agentPath,
    DJANGO_URL: base,
    EXECUTOR_AGENT_DIR: agentPath,
  } as Record<string, string>;
}
export async function runAgent(
  base: string,
  registration: Registration,
  mode: "docker" | "host" = "docker",
  signal?: AbortSignal,
): Promise<void> {
  const agentId = safeSegment(registration.agent_id);
  const directory = agentDirectory(agentId);
  await safeDirectory(join(directory, "workspace"));
  if (mode === "docker" && process.getuid?.() === 0) {
    await chown(directory, 1000, 1000);
    await chown(join(directory, "workspace"), 1000, 1000);
  }
  const client = new Client(base, registration.token);
  try {
    await client.request("/internal/execution/v1/register/", "POST", {
      protocol_version: 3,
      capabilities: ["action", "code", "validate", "test"],
      agent_id: agentId,
    });
  } catch (error) {
    if (error instanceof Error && /API (401|403)/.test(error.message)) return;
    throw error;
  }
  while (!stopping && !signal?.aborted) {
    try {
      const config = z
        .object({ agent_id: z.string(), plugins: z.array(pluginSchema) })
        .parse(await client.request("/internal/execution/v1/configuration/"));
      if (config.agent_id !== agentId)
        throw new Error("Executor agent configuration mismatch");
      for (const plugin of config.plugins) {
        try {
          await installPlugin(plugin, agentId);
        } catch (error) {
          console.error(
            `Plugin ${plugin.slug} installation failed; claimed jobs will report the error: ${error instanceof Error ? error.message : "installation failed"}`,
          );
        }
      }
      const claimed = await client.request(
        "/internal/execution/v1/claim/",
        "POST",
      );
      if (!claimed) {
        await Bun.sleep(2000);
        continue;
      }
      const job = jobSchema.parse(claimed);
      if (job.snapshot.root_agent_id !== agentId)
        throw new Error("Claimed job belongs to another agent");
      if (["validate", "test"].includes(job.operation)) {
        await runIsolatedJob(job, base, developmentSourceArguments(), signal);
        continue;
      }
      const name = `orgsdk-job-${job.run_id}`;
      const command =
        mode === "host"
          ? [
              process.execPath,
              "--no-env-file",
              join(import.meta.dir, "worker.ts"),
            ]
          : [
              "docker",
              "run",
              "--add-host",
              "host.docker.internal:host-gateway",
              "--rm",
              "-i",
              "--name",
              name,
              "--network",
              z.string().min(1).parse(process.env.EXECUTION_NETWORK),
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
              ...agentMountArguments(agentId, directory),
              ...developmentSourceArguments(),
              "--workdir",
              "/agent/workspace",
              "-e",
              `DJANGO_URL=${base}`,
              "-e",
              "EXECUTOR_AGENT_DIR=/agent",
              z.string().min(1).parse(process.env.EXECUTOR_IMAGE),
            ];
      const child = Bun.spawn(command, {
        cwd: join(directory, "workspace"),
        detached: mode === "host" && process.platform !== "win32",
        env: jobEnvironment(base, directory, mode === "host"),
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.stdin.write(JSON.stringify(job));
      child.stdin.end();
      const kill = () => {
        if (mode === "host") {
          if (process.platform === "win32") child.kill("SIGKILL");
          else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw error;
            }
          }
        } else
          void Bun.spawn(["docker", "kill", name], {
            stdout: "ignore",
            stderr: "ignore",
          }).exited;
      };
      signal?.addEventListener("abort", kill, { once: true });
      const deadline = setTimeout(
        kill,
        Math.max(0, Math.min(3_600_000, Date.parse(job.deadline) - Date.now())),
      );
      const control = new Client(base, job.capability);
      const monitor = setInterval(() => {
        void (async () => {
          try {
            const state = z
              .object({ cancel_requested: z.boolean() })
              .parse(
                await control.request(
                  `/internal/execution/v1/runs/${job.run_id}/heartbeat/`,
                  "POST",
                ),
              );
            if (!state.cancel_requested && !stopping) return;
          } catch {
            /* Revoked leases stop execution. */
          }
          kill();
        })();
      }, 10_000);
      await child.exited;
      clearInterval(monitor);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", kill);
    } catch (error) {
      if (error instanceof Error && /API (401|403)/.test(error.message)) return;
      console.error(
        error instanceof Error ? error.message : "Executor failure",
      );
      await Bun.sleep(2000);
    }
  }
}
export async function manage(): Promise<void> {
  const base = z.string().url().parse(process.env.DJANGO_URL);
  const bootstrap = new Client(
    base,
    z.string().min(32).parse(process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN),
  );
  const workers = new Map<
    string,
    {
      promise: Promise<void>;
      controller: AbortController;
      token: string;
      settled: boolean;
      failed: boolean;
      retryAt: number;
      failures: number;
    }
  >();
  while (!stopping) {
    try {
      const response = z
        .object({ registrations: z.array(registrationSchema) })
        .parse(
          await bootstrap.request("/internal/execution/v1/bootstrap/", "POST"),
        );
      const active = new Set(
        response.registrations.map((item) => item.agent_id),
      );
      for (const [id, worker] of workers) {
        if (active.has(id)) continue;
        worker.controller.abort();
        await worker.promise.catch(() => undefined);
        workers.delete(id);
      }
      for (const registration of response.registrations) {
        const previous = workers.get(registration.agent_id);
        if (
          previous?.token === registration.token &&
          (!previous.settled ||
            !previous.failed ||
            Date.now() < previous.retryAt)
        )
          continue;
        if (previous && !previous.settled) {
          previous.controller.abort();
          await previous.promise.catch(() => undefined);
        }
        const controller = new AbortController();
        const state = {
          promise: Promise.resolve(),
          controller,
          token: registration.token,
          settled: false,
          failed: false,
          retryAt: 0,
          failures: previous?.failures ?? 0,
        };
        state.promise = runAgent(
          base,
          registration,
          "docker",
          controller.signal,
        )
          .catch((error) => {
            state.failed = true;
            state.failures++;
            state.retryAt =
              Date.now() +
              Math.min(60_000, 2000 * 2 ** Math.min(state.failures, 5));
            console.error(
              error instanceof Error
                ? error.message
                : "Executor startup failed",
            );
          })
          .finally(() => {
            state.settled = true;
          });
        workers.set(registration.agent_id, state);
      }
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Bootstrap failed",
      );
    }
    await Bun.sleep(5000);
  }
  for (const worker of workers.values()) worker.controller.abort();
  await Promise.allSettled(
    [...workers.values()].map((worker) => worker.promise),
  );
}
if (import.meta.main) await manage();
