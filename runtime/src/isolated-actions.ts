import { z } from "zod";
import type { Job } from "./contract";
import { Client } from "./client";
import { isolatedInputSchema } from "./isolated-worker";

export function isolatedCommand(
  name: string,
  image: string,
  sourceArguments: string[] = [],
): string[] {
  return [
    "docker",
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/work:rw,noexec,nosuid,size=128m,uid=1000,gid=1000",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m,uid=1000,gid=1000",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=128",
    "--memory=512m",
    "--cpus=1",
    "--user",
    "1000:1000",
    ...sourceArguments,
    "--workdir",
    "/work",
    "--entrypoint",
    "bun",
    image,
    "--no-env-file",
    "/executor/src/isolated-worker.ts",
  ];
}

async function boundedText(
  stream: ReadableStream<Uint8Array>,
  kill: (reason?: "cancelled" | "overflow") => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1_000_000) {
      kill("overflow");
      throw new Error("Isolated process output exceeds 1000000 bytes");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runIsolatedJob(
  job: Job,
  base: string,
  sourceArguments: string[],
  signal?: AbortSignal,
): Promise<void> {
  const control = new Client(base, job.capability);
  const path = `/internal/execution/v1/runs/${job.run_id}/`;
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let kill: (reason?: unknown) => void = () => {};
  try {
    // Explicit allowlist: the full claim and its credentials never cross this boundary.
    const payload = isolatedInputSchema.parse({
      operation: job.operation,
      source: job.snapshot.source,
      sdk: job.snapshot.sdk,
      test_suite: job.snapshot.test_suite,
      output_schema: job.snapshot.output_schema,
    });
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 800_000)
      throw new Error("Isolated input exceeds 800000 bytes");
    const name = `orgsdk-isolated-${job.run_id}`;
    const child = Bun.spawn(
      isolatedCommand(
        name,
        z.string().min(1).parse(process.env.EXECUTOR_IMAGE),
        sourceArguments,
      ),
      {
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.DOCKER_HOST
            ? { DOCKER_HOST: process.env.DOCKER_HOST }
            : {}),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    kill = (reason?: unknown) => {
      cancelled = reason !== "overflow";
      void Bun.spawn(["docker", "kill", name], {
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.DOCKER_HOST
            ? { DOCKER_HOST: process.env.DOCKER_HOST }
            : {}),
        },
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      child.kill();
    };
    signal?.addEventListener("abort", kill, { once: true });
    child.stdin.write(serialized);
    child.stdin.end();
    deadline = setTimeout(
      kill,
      Math.max(0, Math.min(300_000, Date.parse(job.deadline) - Date.now())),
    );
    timer = setInterval(() => {
      void (async () => {
        try {
          const state = z
            .object({ cancel_requested: z.boolean(), status: z.string() })
            .parse(await control.request(`${path}heartbeat/`, "POST"));
          if (
            state.cancel_requested ||
            ["failed", "interrupted", "cancelled"].includes(state.status)
          )
            kill();
        } catch {
          kill();
        }
      })();
    }, 10_000);
    if (signal?.aborted) kill();
    const [stdout, stderr, code] = await Promise.all([
      boundedText(child.stdout, () => kill("overflow")),
      boundedText(child.stderr, () => kill("overflow")),
      child.exited,
    ]);
    if (cancelled)
      throw new Error("Isolated execution cancelled or deadline reached");
    if (code !== 0)
      throw new Error(stderr.slice(0, 2000) || "Isolated worker failed");
    const result = z.record(z.string(), z.unknown()).parse(JSON.parse(stdout));
    const passed =
      job.operation === "validate"
        ? result.valid === true
        : result.passed === true;
    const output = {
      result: {
        ...result,
        configuration_revision: job.snapshot.configuration_revision,
        sdk_revision: job.snapshot.sdk_revision,
        test_suite: job.snapshot.test_suite
          ? {
              id: job.snapshot.test_suite.id,
              revision: job.snapshot.test_suite.revision,
              digest: job.snapshot.test_suite.digest,
            }
          : undefined,
      },
    };
    await control.request(`${path}events/`, "POST", {
      sequence: 1,
      kind: job.operation === "validate" ? "validation.result" : "test.result",
      data: {
        passed,
        case_count: Array.isArray(result.cases) ? result.cases.length : 0,
        diagnostics: Array.isArray(result.diagnostics)
          ? result.diagnostics.slice(0, 10)
          : [],
      },
    });
    await control.request(`${path}complete/`, "POST", {
      status: passed ? "succeeded" : "failed",
      output,
      ...(passed ? {} : { error: "Validation or tests failed" }),
    });
  } catch (error) {
    await control
      .request(`${path}complete/`, "POST", {
        status: cancelled ? "cancelled" : "failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Isolated execution failed",
      })
      .catch(() => undefined);
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
    signal?.removeEventListener("abort", kill);
  }
}
