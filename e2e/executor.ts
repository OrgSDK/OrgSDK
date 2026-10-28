import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { jobSchema } from "../runtime/src/contract";
import { testClient } from "./fixtures";

export async function prepareExecutor(
  page: Page,
  projectId: string,
): Promise<{ execute: (runId: string) => Promise<void> }> {
  const client = await testClient(page);
  const origin = new URL(page.url()).origin;
  const registered = await client.projects.connectExecutor.mutate({
    id: projectId,
    locally_managed: false,
  });
  const headers = { Authorization: `Bearer ${registered.token}` };
  const response = await page.request.post(
    `${origin}/internal/execution/v1/register/`,
    {
      headers,
      data: { protocol_version: 3, capabilities: ["action", "code"] },
    },
  );
  if (response.status() !== 200) {
    throw new Error(`Executor registration failed (${response.status()}).`);
  }
  return {
    async execute(runId) {
      const claimed = await page.request.post(
        `${origin}/internal/execution/v1/claim/`,
        { headers },
      );
      if (claimed.status() !== 200) {
        throw new Error(
          `Executor could not claim the queued run (${claimed.status()}).`,
        );
      }
      const payload: unknown = await claimed.json();
      const job = jobSchema.parse(payload);
      if (job.run_id !== runId || job.snapshot.root_agent_id !== projectId) {
        throw new Error(
          "The executor claimed a run outside this test project.",
        );
      }
      const directory = await mkdtemp(join(tmpdir(), "orgsdk-browser-worker-"));
      const workerPath = fileURLToPath(
        new URL("../runtime/src/worker.ts", import.meta.url),
      );
      const worker = spawn(
        process.env.ORGSDK_E2E_BUN ?? "bun",
        ["--no-env-file", workerPath],
        {
          cwd: dirname(workerPath),
          env: {
            PATH: process.env.PATH ?? "",
            DJANGO_URL: origin,
            EXECUTOR_AGENT_DIR: directory,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let diagnostic = "";
      worker.stdout.resume();
      worker.stderr.setEncoding("utf8");
      worker.stderr.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") {
          diagnostic = (diagnostic + chunk).slice(-8000);
        }
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        worker.once("error", reject);
        worker.stdin.once("error", reject);
        worker.once("close", (code: number | null) => resolve(code));
      });
      const deadline = setTimeout(() => worker.kill("SIGKILL"), 20000);
      try {
        worker.stdin.end(JSON.stringify(job));
        const exitCode = await exited;
        if (exitCode !== 0) {
          const safeDiagnostic = diagnostic
            .replaceAll(job.capability, "[redacted]")
            .replaceAll(registered.token, "[redacted]");
          throw new Error(
            `Separate Bun worker failed (${exitCode}): ${safeDiagnostic}`,
          );
        }
      } finally {
        clearTimeout(deadline);
        if (worker.exitCode === null && worker.signalCode === null) {
          worker.kill("SIGKILL");
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
