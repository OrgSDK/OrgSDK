import { expect, test } from "bun:test";
import { Client } from "../../runtime/src/client";
import { jobSchema } from "../../runtime/src/contract";
import { fixture } from "./integration-fixture";
import { runSchema } from "./wire-schemas";

test("the executor heartbeat renews a claimed run through the server protocol", async () => {
  const environment = await fixture();
  try {
    const token = await environment.register();
    const run = runSchema.parse(
      await environment.data(
        "runs.create",
        {
          project: environment.project.id,
          operation: "code",
          source: "return 42;",
          inputs: {},
          idempotency_key: "executor-heartbeat",
        },
        "mutation",
      ),
    );
    const manager = new Client(environment.origin, token);
    const job = jobSchema.parse(await manager.claim());
    expect(job.run_id).toBe(run.id);

    const worker = new Client(environment.origin, job.capability);
    expect(await worker.heartbeat(run.id)).toEqual({
      status: "running",
      cancel_requested: false,
    });
    await worker.complete(run.id, {
      status: "succeeded",
      output: { result: 42 },
    });
    const completed = runSchema.parse(
      await environment.data("runs.get", { id: run.id }),
    );
    expect(completed.status).toBe("succeeded");
    expect(completed.output).toEqual({ result: 42 });
  } finally {
    await environment.close();
  }
});
