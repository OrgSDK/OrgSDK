import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type api, runSchema, waitForRun } from "./distribution-fixture.ts";
import { mcpSmokeServer } from "./mcp-smoke-server.ts";
import type { sessionCommandSchema } from "../runtime/src/session-job-contract.ts";

const createdConnectionSchema = z.object({ id: z.uuid() });
const discoveryRunSchema = z.object({ run: z.uuid() });
const resultSchema = z.object({ result: z.unknown() });
const sessionSchema = z.object({
  id: z.uuid(),
  generation: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
});
const cellSchema = z.object({
  cell: z.object({
    sequence: z.number().int().positive(),
    status: z.literal("succeeded"),
    result: z.unknown(),
  }),
});
const found = {
  content: [{ type: "text", text: "found" }],
  structuredContent: { found: true },
};

async function runSession(
  rpc: ReturnType<typeof api>,
  project: string,
  session: z.input<typeof sessionCommandSchema>,
  source?: string,
) {
  const run = runSchema.parse(
    await rpc(
      "runs.session",
      { project, session, source, idempotency_key: randomUUID() },
      true,
    ),
  );
  return resultSchema.parse((await waitForRun(rpc, run.id)).output).result;
}

async function verifySession(rpc: ReturnType<typeof api>, project: string) {
  const session = sessionSchema.parse(
    await runSession(rpc, project, {
      operation: "open",
    }),
  );
  const execute = async (expectedSequence: number, source: string) => {
    const result = await runSession(
      rpc,
      project,
      {
        operation: "execute",
        id: session.id,
        generation: session.generation,
        cellId: randomUUID(),
        expectedSequence,
      },
      source,
    );
    return cellSchema.parse(result).cell;
  };
  const first = await execute(
    session.sequence,
    'const query = "tarball session"; const result = await remoteProof.searchRecords({ query }); return result;',
  );
  assert.deepEqual(first.result, found);
  const second = await execute(first.sequence, "return { query, result };");
  assert.deepEqual(second.result, { query: "tarball session", result: found });
  await runSession(rpc, project, { operation: "close", id: session.id });
}

async function verifyReplay(rpc: ReturnType<typeof api>, project: string) {
  const action = createdConnectionSchema.parse(
    await rpc("actions.create", { project, name: "Packaged MCP replay" }, true),
  );
  await rpc(
    "actions.createVersion",
    {
      id: action.id,
      source:
        "return await remoteProof.searchRecords({ query: String(actionParams.query) });",
      input_schema: z.toJSONSchema(z.object({ query: z.string() })),
    },
    true,
  );
  const replay = runSchema.parse(
    await rpc(
      "runs.create",
      {
        project,
        operation: "action",
        action: action.id,
        version: 1,
        inputs: { query: "tarball replay" },
        idempotency_key: randomUUID(),
      },
      true,
    ),
  );
  assert.deepEqual((await waitForRun(rpc, replay.id)).output, {
    result: found,
  });
}

export async function verifyPackagedMcp(
  rpc: ReturnType<typeof api>,
  project: string,
) {
  const server = await mcpSmokeServer();
  try {
    const connection = createdConnectionSchema.parse(
      await rpc(
        "plugins.mcp.create",
        {
          project,
          slug: "remote-proof",
          endpoint: server.endpoint,
          auth_mode: "headers",
          headers: { Authorization: "Bearer package-mcp-secret" },
        },
        true,
      ),
    );
    const discovery = discoveryRunSchema.parse(
      await rpc("plugins.mcp.discover", connection, true),
    );
    await waitForRun(rpc, discovery.run);
    assert.deepEqual(server.queries, []);
    await rpc(
      "plugins.mcp.accept",
      { id: connection.id, run: discovery.run, tools: ["search_records"] },
      true,
    );
    const sdk = await rpc("projects.sdk", { id: project });
    assert.match(JSON.stringify(sdk), /searchRecords/);
    await verifySession(rpc, project);
    await verifyReplay(rpc, project);
    assert.deepEqual(server.queries, ["tarball session", "tarball replay"]);
    await rpc("plugins.delete", connection, true);
    console.log(
      "Packed executor passed MCP discovery, catalogue review, retained cells and saved replay.",
    );
  } finally {
    await server.close();
  }
}
