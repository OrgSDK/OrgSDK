import { expect, test } from "bun:test";
import { z } from "zod";
import { Client } from "../../runtime/src/client";
import { jobSchema } from "../../runtime/src/contract";
import { plugins } from "../db/schema";
import { base } from "../shared/records";
import { fixture } from "./integration-fixture";

const tokenSchema = z.object({ id: z.uuid(), token: z.string() });
const idSchema = z.object({ id: z.uuid() });
const scopes = ["code:execute", "runs:read"];

test("session admission binds scope, command and idempotency to the caller and requires a capable runner", async () => {
  const app = await fixture();
  try {
    const project = app.project.id;
    const issueToken = async (projects: string[], permissions: string[]) =>
      tokenSchema.parse(
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
    const session = (input: unknown, token: string) =>
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
