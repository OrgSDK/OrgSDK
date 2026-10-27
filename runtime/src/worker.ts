import { z } from "zod";
import { Client } from "./client";
import { jobSchema } from "./contract";
import { Runner } from "./runner";

const job = jobSchema.parse(JSON.parse(await Bun.stdin.text()));
const base = z.string().url().parse(process.env.DJANGO_URL);
const controller = new AbortController();
const client = new Client(base, job.capability, controller.signal);
const control = new Client(base, job.capability);
const heartbeat = z.object({
  cancel_requested: z.boolean(),
  status: z.string(),
});
let stopped = false;
const timer = setInterval(() => {
  void (async () => {
    try {
      const state = heartbeat.parse(
        await control.request(
          `/internal/execution/v1/runs/${job.run_id}/heartbeat/`,
          "POST",
        ),
      );
      if (
        state.cancel_requested ||
        ["failed", "interrupted", "cancelled"].includes(state.status)
      )
        controller.abort();
    } catch {
      controller.abort();
    }
  })();
}, 10_000);
const deadline = setTimeout(
  () => controller.abort(),
  Math.max(0, Date.parse(job.deadline) - Date.now()),
);
try {
  const output = await new Runner(job, client, controller.signal).run();
  await control.request(
    `/internal/execution/v1/runs/${job.run_id}/complete/`,
    "POST",
    { status: "succeeded", output: { result: output } },
  );
  stopped = true;
} catch (error) {
  await control
    .request(`/internal/execution/v1/runs/${job.run_id}/complete/`, "POST", {
      status: controller.signal.aborted ? "cancelled" : "failed",
      error: error instanceof Error ? error.message : "Execution failed",
    })
    .catch(() => undefined);
} finally {
  clearInterval(timer);
  clearTimeout(deadline);
}
if (!stopped) process.exitCode = 1;
