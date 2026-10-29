import {
  developmentSourceArguments,
  agentMountArguments,
  jobEnvironment,
} from "./executor-configuration";
export {
  developmentSourceArguments,
  agentMountArguments,
  jobEnvironment,
} from "./executor-configuration";
import {
  isEntrypoint,
  spawnProcess,
  stopHostProcess,
  workerCommand,
} from "./process-runtime";
import { setTimeout as sleep } from "node:timers/promises";
import { runIsolatedJob } from "./isolated-actions";
import { chown } from "node:fs/promises";
import { join } from "node:path";
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
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

export async function runAgent(
  base: string,
  registration: Registration,
  mode: "docker" | "host" = "docker",
  signal?: AbortSignal,
): Promise<void> {
  signal = AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]);
  if (signal.aborted) return;
  const agentId = safeSegment(registration.agent_id);
  const directory = agentDirectory(agentId);
  await safeDirectory(join(directory, "workspace"));
  if (mode === "docker" && process.getuid?.() === 0) {
    await chown(directory, 1000, 1000);
    await chown(join(directory, "workspace"), 1000, 1000);
  }
  const client = new Client(base, registration.token, signal);
  try {
    await client.request("/internal/execution/v1/register/", "POST", {
      protocol_version: 3,
      capabilities: ["action", "code", "validate", "test"],
      agent_id: agentId,
    });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && /API (401|403)/.test(error.message))
    )
      return;
    throw error;
  }
  while (!signal.aborted) {
    try {
      const config = z
        .object({ agent_id: z.string(), plugins: z.array(pluginSchema) })
        .parse(await client.request("/internal/execution/v1/configuration/"));
      if (config.agent_id !== agentId)
        throw new Error("Executor agent configuration mismatch");
      for (const plugin of config.plugins) {
        try {
          await installPlugin(plugin, agentId, undefined, signal);
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
        await sleep(2000, undefined, { signal }).catch(() => undefined);
        continue;
      }
      if (signal.aborted) return;
      const job = jobSchema.parse(claimed);
      if (job.snapshot.root_agent_id !== agentId)
        throw new Error("Claimed job belongs to another agent");
      if (["validate", "test"].includes(job.operation)) {
        await runIsolatedJob(
          job,
          base,
          developmentSourceArguments(),
          signal,
          mode,
        );
        continue;
      }
      const name = `orgsdk-job-${job.run_id}`;
      const command =
        mode === "host"
          ? workerCommand(import.meta.url, "./worker")
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
      const child = spawnProcess(command, {
        cwd: join(directory, "workspace"),
        detached: mode === "host" && process.platform !== "win32",
        env: jobEnvironment(base, directory, mode === "host"),
        stdout: "ignore",
        stderr: "ignore",
      });
      child.stdin.write(JSON.stringify(job));
      child.stdin.end();
      const kill = () => {
        if (mode === "host") stopHostProcess(child);
        else
          void spawnProcess(["docker", "kill", name], {
            stdout: "ignore",
            stderr: "ignore",
          }).exited;
      };
      signal.addEventListener("abort", kill, { once: true });
      if (signal.aborted) kill();
      const deadline = setTimeout(
        kill,
        Math.max(0, Math.min(3_600_000, Date.parse(job.deadline) - Date.now())),
      );
      const jobLifetime = new AbortController();
      const control = new Client(
        base,
        job.capability,
        AbortSignal.any([signal, jobLifetime.signal]),
      );
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
            if (!state.cancel_requested && !signal.aborted) return;
          } catch {
            /* Revoked leases stop execution. */
          }
          if (!jobLifetime.signal.aborted) kill();
        })();
      }, 10_000);
      try {
        await child.exited;
      } finally {
        // A completed worker may leave unref'ed plugin helpers in its process group.
        if (mode === "host") stopHostProcess(child);
        jobLifetime.abort();
        clearInterval(monitor);
        clearTimeout(deadline);
        signal.removeEventListener("abort", kill);
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && /API (401|403)/.test(error.message))
      )
        return;
      console.error(
        error instanceof Error ? error.message : "Executor failure",
      );
      await sleep(2000, undefined, { signal }).catch(() => undefined);
    }
  }
}
export async function manage(
  mode: "docker" | "host" = "docker",
): Promise<void> {
  const base = z.string().url().parse(process.env.DJANGO_URL);
  const bootstrap = new Client(
    base,
    z.string().min(32).parse(process.env.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN),
    shutdown.signal,
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
  while (!shutdown.signal.aborted) {
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
        state.promise = runAgent(base, registration, mode, controller.signal)
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
      if (shutdown.signal.aborted) break;
      console.error(
        error instanceof Error ? error.message : "Bootstrap failed",
      );
    }
    await sleep(5000, undefined, { signal: shutdown.signal }).catch(
      () => undefined,
    );
  }
  for (const worker of workers.values()) worker.controller.abort();
  await Promise.allSettled(
    [...workers.values()].map((worker) => worker.promise),
  );
}
if (isEntrypoint(import.meta.url)) await manage();
