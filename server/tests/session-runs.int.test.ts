import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Client } from "../../runtime/src/client";
import { jobSchema } from "../../runtime/src/contract";
import { accessTokens, executors, plugins } from "../db/schema";
import { base } from "../shared/records";
import {
  issuedMcpAccessTokenSchema,
  type McpAccessToken,
} from "../tokens/access-token";
import { fixture } from "./integration-fixture";

const idSchema = z.object({ id: z.uuid() });
const runnerSchema = z.object({ id: z.uuid(), pool: z.string() });
const scopes = ["code:execute", "runs:read"];

test("session admission binds scope, command and idempotency to the caller and requires a capable runner", async () => {
  const app = await fixture();
  try {
    const project = app.project.id;
    const issueToken = async (projects: string[], permissions: string[]) =>
      issuedMcpAccessTokenSchema.parse(
        await app.data(
          "tokens.create",
          { name: "test client", projects, scopes: permissions },
          "mutation",
        ),
      );
    const owner = await issueToken([project], scopes);
    const stranger = await issueToken([], scopes);
    const reader = await issueToken([project], ["runs:read"]);
    const open = {
      project,
      session: { operation: "open" },
      idempotency_key: "open",
    };
    const session = (input: unknown, token: McpAccessToken) =>
      app.rpc("runs.session", input, "mutation", token);
    expect((await session(open, stranger.token)).status).toBe(403);
    expect((await session(open, reader.token)).status).toBe(403);
    expect(
      (
        await session(
          { ...open, session_scope: { ownerId: "forged" } },
          owner.token,
        )
      ).status,
    ).toBe(400);

    const worker = new Client(app.origin, await app.register());
    expect((await session(open, owner.token)).ok).toBe(false);
    await Promise.resolve(
      expect(
        worker.register({ protocol_version: 3, capabilities: ["session"] }),
      ).rejects.toThrow("400"),
    );
    await worker.register({ protocol_version: 4, capabilities: ["session"] });
    const admitted = idSchema.parse(
      await app.data("runs.session", open, "mutation", owner.token),
    );
    expect(
      idSchema.parse(
        await app.data("runs.session", open, "mutation", owner.token),
      ),
    ).toEqual(admitted);
    const read = {
      ...open,
      session: { operation: "read", id: crypto.randomUUID() },
    };
    expect((await session(read, owner.token)).status).toBe(400);
    expect(
      (await session({ ...open, source: "return 1;" }, owner.token)).status,
    ).toBe(400);

    await worker.register({ protocol_version: 4, capabilities: ["code"] });
    expect(await worker.claim()).toBeUndefined();
    await worker.register({ protocol_version: 4, capabilities: ["session"] });
    const job = jobSchema.parse(await worker.claim());
    expect(job.run_id).toBe(admitted.id);
    expect(job.snapshot.session_scope).toEqual({
      projectId: project,
      workspaceId: String(job.workspace_id),
      ownerId: `token:${owner.id}`,
    });
    const control = new Client(app.origin, job.capability);
    await Promise.resolve(
      expect(control.projectData("list_tables", {})).rejects.toThrow(
        "lifecycle",
      ),
    );
    await app.data("tokens.revoke", { id: owner.id }, "mutation");
    expect(await control.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: true,
    });
    await control.complete(job.run_id, { status: "cancelled" });
    expect(await app.data("runs.get", admitted)).toMatchObject({
      status: "cancelled",
    });
  } finally {
    await app.close();
  }
});

test("a changed project contract withdraws a cell capability before another tool call", async () => {
  const app = await fixture();
  try {
    const worker = new Client(app.origin, await app.register());
    await worker.register({ protocol_version: 4, capabilities: ["session"] });
    const project = app.project.id;
    await app.data(
      "runs.session",
      {
        project,
        source: "return 1;",
        idempotency_key: "cell",
        session: {
          operation: "execute",
          id: crypto.randomUUID(),
          cellId: crypto.randomUUID(),
          generation: 1,
          expectedSequence: 0,
        },
      },
      "mutation",
    );
    const job = jobSchema.parse(await worker.claim());
    const control = new Client(app.origin, job.capability);
    expect(await control.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: false,
    });
    app.store.db
      .insert(plugins)
      .values({
        ...base(job.workspace_id),
        projectId: project,
        slug: "added-later",
        version: "1",
        digest: "fixture",
      })
      .run();
    await Promise.resolve(
      expect(control.projectData("list_tables", {})).rejects.toThrow(
        "no longer active",
      ),
    );
    expect(await control.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: true,
    });
  } finally {
    await app.close();
  }
});

test("session admission requires a runner in the workspace execution pool", async () => {
  const app = await fixture();
  try {
    const worker = new Client(app.origin, await app.register());
    const runner = runnerSchema.parse(
      await worker.register({ protocol_version: 4, capabilities: ["session"] }),
    );
    const changePool = (pool: string) =>
      app.store.db
        .update(executors)
        .set({ pool })
        .where(eq(executors.id, runner.id))
        .run();
    const open = {
      project: app.project.id,
      session: { operation: "open" },
      idempotency_key: "pool-alignment",
    };
    changePool("other-pool");
    const unavailable = await app.rpc("runs.session", open, "mutation");
    expect(unavailable.status).toBe(412);
    expect(await worker.claim()).toBeUndefined();

    changePool(runner.pool);
    const admitted = idSchema.parse(
      await app.data("runs.session", open, "mutation"),
    );
    expect(jobSchema.parse(await worker.claim()).run_id).toBe(admitted.id);
  } finally {
    await app.close();
  }
});

test("session retries compare JSON inputs by value", async () => {
  const app = await fixture();
  try {
    const worker = new Client(app.origin, await app.register());
    await worker.register({ protocol_version: 4, capabilities: ["session"] });
    const request = {
      project: app.project.id,
      session: {
        operation: "execute",
        id: crypto.randomUUID(),
        cellId: crypto.randomUUID(),
        generation: 1,
        expectedSequence: 0,
      },
      source: "return actionParams;",
      idempotency_key: "equivalent-inputs",
    };
    const first = {
      ...request,
      inputs: { selection: { name: "example", visible: true }, count: 1 },
    };
    const retry = {
      ...request,
      inputs: { count: 1, selection: { visible: true, name: "example" } },
    };
    const admitted = idSchema.parse(
      await app.data("runs.session", first, "mutation"),
    );
    expect(
      idSchema.parse(await app.data("runs.session", retry, "mutation")),
    ).toEqual(admitted);
    const changed = { ...retry, inputs: { ...retry.inputs, count: 2 } };
    expect((await app.rpc("runs.session", changed, "mutation")).status).toBe(
      400,
    );
  } finally {
    await app.close();
  }
});

test("a queued session read observes updated reader permissions", async () => {
  const app = await fixture();
  try {
    const project = app.project.id;
    const owner = issuedMcpAccessTokenSchema.parse(
      await app.data(
        "tokens.create",
        { name: "reader", projects: [project], scopes },
        "mutation",
      ),
    );
    const worker = new Client(app.origin, await app.register());
    await worker.register({ protocol_version: 4, capabilities: ["session"] });
    await app.data(
      "runs.session",
      {
        project,
        idempotency_key: "read-history",
        session: { operation: "read", id: crypto.randomUUID() },
      },
      "mutation",
      owner.token,
    );
    const job = jobSchema.parse(await worker.claim());
    const control = new Client(app.origin, job.capability);
    expect(await control.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: false,
    });
    app.store.db
      .update(accessTokens)
      .set({ scopes: ["code:execute"] })
      .where(eq(accessTokens.id, owner.id))
      .run();
    expect(await control.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: true,
    });
  } finally {
    await app.close();
  }
});
