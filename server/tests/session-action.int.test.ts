import { expect, test } from "bun:test";
import { z } from "zod";
import { join } from "node:path";
import { fixture } from "./integration-fixture";
import { Client } from "../../runtime/src/client";
import { jobSchema } from "../../runtime/src/contract";
import { SessionJobs } from "../../runtime/src/session-job";

test("session action enforces its placement, live checks, version identity and cell order", async () => {
  const app = await fixture();
  const project = app.project.id;
  const jobs = new SessionJobs({
    base: app.origin,
    agentId: project,
    directory: join(app.dir, "agents", project),
    mode: "host",
  });
  const mutate = (path: string, input: unknown) =>
    app.data(path, input, "mutation");
  const enqueue = (input: Record<string, unknown>) =>
    mutate("runs.session", {
      project,
      idempotency_key: crypto.randomUUID(),
      ...input,
    });
  try {
    const worker = new Client(app.origin, await app.register());
    await worker.register({
      protocol_version: 4,
      capabilities: ["session", "session_actions"],
    });
    const finish = async (value: unknown) => {
      const run = z.object({ id: z.uuid() }).parse(value);
      const job = jobSchema.parse(await worker.claim());
      expect(job.run_id).toBe(run.id);
      await jobs.run(job, new AbortController().signal);
      return z
        .object({
          status: z.string(),
          error: z.string(),
          action_version: z.uuid().nullable(),
          output: z.object({
            result: z.unknown(),
            session: z.unknown().optional(),
          }),
        })
        .parse(await app.data("runs.get", run));
    };
    const { id, generation } = z
      .object({ id: z.uuid(), generation: z.number() })
      .parse(
        (await finish(await enqueue({ session: { operation: "open" } }))).output
          .result,
      );
    const source =
      "const value = defineParams(z.object({value:z.string()})).value; await writeFile('result',value); return value;";
    const input = {
      project,
      name: "Finish",
      source,
      execution: {
        mode: "session-only",
        requires: [
          {
            label: "a ready workspace",
            expression: "(await readFile('ready')) === 'yes'",
          },
        ],
        provides: [
          {
            label: "the result",
            expression: "(await readFile('result')) === actionParams.value",
          },
        ],
      },
    };
    const parseVersion = z.object({
      action: z.uuid(),
      version: z.object({ id: z.uuid(), number: z.number() }),
    });
    const first = parseVersion.parse(await mutate("actions.saveAction", input));
    const second = parseVersion.parse(
      await mutate("actions.saveAction", {
        ...input,
        execution: { mode: "either" },
      }),
    );
    expect(second.version.number).toBe(2);
    const selected = {
      action: first.action,
      version: 1,
      inputs: { value: "complete" },
    };
    expect(
      (
        await app.rpc(
          "runs.create",
          {
            project,
            operation: "action",
            idempotency_key: "standalone",
            ...selected,
          },
          "mutation",
        )
      ).status,
    ).toBe(400);
    const command = (sequence: number) => ({
      operation: "execute",
      id,
      generation,
      cellId: crypto.randomUUID(),
      expectedSequence: sequence,
    });
    const missed = await finish(
      await enqueue({ ...selected, session: command(0) }),
    );
    expect(missed.status).toBe("failed");
    expect(missed.error).toContain("Action requires a ready workspace");
    await finish(
      await enqueue({
        source: "const value = 42; await writeFile('ready','yes');",
        session: command(1),
      }),
    );
    const pinned = command(2);
    const result = await finish(
      await enqueue({ ...selected, session: pinned }),
    );
    expect(result).toMatchObject({
      status: "succeeded",
      action_version: first.version.id,
      output: { result: "complete" },
    });
    const receipt = await finish(
      await enqueue({ ...selected, session: pinned }),
    );
    expect(receipt.output.session).toEqual(result.output.session);
    const conflict = await enqueue({
      ...selected,
      version: 2,
      session: pinned,
    });
    const job = jobSchema.parse(await worker.claim());
    await jobs.run(job, new AbortController().signal);
    expect(
      await app.data("runs.get", z.object({ id: z.uuid() }).parse(conflict)),
    ).toMatchObject({
      status: "failed",
      error: "Cell ID was already used with a different payload",
    });
    const next = await finish(
      await enqueue({ source: "return value;", session: command(3) }),
    );
    expect(next.output.result).toMatchObject({
      cell: { status: "succeeded", result: 42 },
    });
  } finally {
    await jobs.dispose();
    await app.close();
  }
}, 30000);
