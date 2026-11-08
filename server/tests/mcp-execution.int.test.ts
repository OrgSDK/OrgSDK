import { expect, test } from "bun:test";
import { z } from "zod";
import { jobSchema } from "../../runtime/src/contract";
import { Client } from "../../runtime/src/client";
import { validateCode } from "../../runtime/src/validate-code";
import { connectedMcpFixture } from "./mcp-fixture";

const savedActionSchema = z.object({ action: z.uuid() });
const createdRunSchema = z.object({ id: z.uuid() });
const createdCredentialSchema = z.object({ id: z.uuid() });

const source =
  'return await customerTools.searchRecords({ query: "example" });';
test("MCP connection reviews tools, exposes SDK, executes code and a saved action with traces", async () => {
  const fixture = await connectedMcpFixture();
  try {
    const discovery = await fixture.discover();
    expect(discovery.job.protocol_version).toBe(4);
    expect(fixture.remote.calls).toBe(0);
    expect(JSON.stringify(discovery.job)).not.toContain("synthetic-mcp-secret");
    const before = await fixture.data("projects.sdk", {
      id: fixture.project.id,
    });
    expect(JSON.stringify(before)).not.toContain("searchRecords");
    await fixture.accept(discovery.run);
    const sdk = await fixture.data("projects.sdk", { id: fixture.project.id });
    expect(JSON.stringify(sdk)).toContain('"remote_name":"search_records"');
    expect(validateCode(source, sdk).valid).toBe(true);
    expect(
      validateCode("return customerTools.searchRecords({ query: 42 });", sdk)
        .valid,
    ).toBe(false);
    await fixture.data(
      "runs.create",
      {
        project: fixture.project.id,
        operation: "code",
        source,
        idempotency_key: "mcp-code",
      },
      "mutation",
    );
    const job = jobSchema.parse(await fixture.worker.claim());
    expect(job.protocol_version).toBe(4);
    expect(await fixture.execute(job)).toMatchObject({
      structuredContent: { found: "example" },
    });
    const events = await fixture.data("runs.events", { id: job.run_id });
    expect(JSON.stringify(events)).toContain("searchRecords");
    expect(JSON.stringify(events)).not.toContain("synthetic-mcp-secret");
    const saved = savedActionSchema.parse(
      await fixture.data(
        "actions.saveAction",
        {
          project: fixture.project.id,
          name: "Find records",
          source,
          output_schema: { type: "object" },
        },
        "mutation",
      ),
    );
    await fixture.data(
      "runs.create",
      {
        project: fixture.project.id,
        operation: "action",
        action: saved.action,
        version: 1,
        idempotency_key: "mcp-action",
      },
      "mutation",
    );
    expect(
      await fixture.execute(jobSchema.parse(await fixture.worker.claim())),
    ).toMatchObject({ structuredContent: { found: "example" } });
    expect(fixture.remote.calls).toBe(2);
  } finally {
    await fixture.close();
  }
}, 30000);

test("MCP snapshots stay immutable, revocation cancels jobs, old workers cannot claim MCP", async () => {
  const fixture = await connectedMcpFixture();
  try {
    await fixture.accept((await fixture.discover()).run);
    const created = createdRunSchema.parse(
      await fixture.data(
        "runs.create",
        {
          project: fixture.project.id,
          operation: "code",
          source,
          idempotency_key: "pinned",
        },
        "mutation",
      ),
    );
    await fixture.worker.register({
      protocol_version: 3,
      capabilities: ["code", "action"],
    });
    expect(await fixture.worker.claim()).toBeUndefined();
    await fixture.worker.register({
      protocol_version: 4,
      capabilities: ["code", "action", "mcp_discover"],
    });
    const job = jobSchema.parse(await fixture.worker.claim());
    const snapshot = JSON.stringify(job.snapshot);
    const client = new Client(fixture.origin, job.capability);
    await fixture.data(
      "plugins.update",
      { id: fixture.connection.id, enabled: false },
      "mutation",
    );
    expect(await client.heartbeat(job.run_id)).toMatchObject({
      cancel_requested: true,
    });
    const credential = job.snapshot.agents[0]?.plugins[0]?.credential_id;
    if (!credential) {
      throw new Error("Missing test credential");
    }
    await Promise.resolve(expect(client.secret(credential)).rejects.toThrow());
    expect(JSON.stringify(job.snapshot)).toBe(snapshot);
    expect(job.run_id).toBe(created.id);
    expect(fixture.remote.calls).toBe(0);
  } finally {
    await fixture.close();
  }
}, 30000);

test("discovery authority cannot execute product operations or obtain another credential", async () => {
  const fixture = await connectedMcpFixture();
  try {
    const foreign = createdCredentialSchema.parse(
      await fixture.data(
        "credentials.create",
        { name: "other", provider: "test", secret: { token: "other" } },
        "mutation",
      ),
    );
    await fixture.data("plugins.mcp.discover", fixture.connection, "mutation");
    const job = jobSchema.parse(await fixture.worker.claim());
    const client = new Client(fixture.origin, job.capability);
    await Promise.resolve(
      expect(client.secret(foreign.id)).rejects.toThrow("outside"),
    );
    await Promise.resolve(
      expect(client.projectData("list_tables", {})).rejects.toThrow(
        "Discovery",
      ),
    );
    await Promise.resolve(
      expect(
        client.saveArtifact({
          run: job.run_id,
          name: "forbidden",
          content: "data",
        }),
      ).rejects.toThrow("Discovery"),
    );
    expect(
      (
        await fixture.rpc(
          "plugins.mcp.discover",
          fixture.connection,
          "mutation",
          job.capability,
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(fixture.remote.calls).toBe(0);
  } finally {
    await fixture.close();
  }
}, 30000);
