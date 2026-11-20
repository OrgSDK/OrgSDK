import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type api, runSchema, waitForRun } from "./distribution-fixture.ts";
import { mcpSmokeServer } from "./mcp-smoke-server.ts";

const createdConnectionSchema = z.object({ id: z.uuid() });
const discoveryRunSchema = z.object({ run: z.uuid() });

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
    assert.equal(server.calls, 0);
    await rpc(
      "plugins.mcp.accept",
      { id: connection.id, run: discovery.run, tools: ["search_records"] },
      true,
    );
    const sdk = await rpc("projects.sdk", { id: project });
    assert.match(JSON.stringify(sdk), /searchRecords/);
    const run = runSchema.parse(
      await rpc(
        "runs.create",
        {
          project,
          operation: "code",
          source:
            'return await remoteProof.searchRecords({ query: "tarball" });',
          idempotency_key: randomUUID(),
        },
        true,
      ),
    );
    assert.deepEqual((await waitForRun(rpc, run.id)).output, {
      result: {
        content: [{ type: "text", text: "found" }],
        structuredContent: { found: true },
      },
    });
    assert.equal(server.calls, 1);
    await rpc("plugins.delete", connection, true);
    console.log(
      "Packed executor passed remote MCP discovery, catalogue review and tool execution.",
    );
  } finally {
    await server.close();
  }
}
