import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  mcpConnections,
  plugins,
  runs,
  workspaces,
  projects,
  credentials,
} from "../db/schema";
import { rpcFixture } from "./rpc-fixture";

const tool = {
  name: "search_records",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
};
test("catalogue review retains aliases and existing snapshots; removing access cancels queued runs", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const plugin = await caller.plugins.mcp.create({
      project: fixture.project.id,
      slug: "customer-tools",
      endpoint: "https://mcp.example.test/tools",
    });
    function candidate(tools: (typeof tool)[]) {
      const run = crypto.randomUUID();
      fixture.store.db
        .update(mcpConnections)
        .set({
          candidate: {
            tools,
            transport: "streamable-http",
            authRequired: false,
          },
          discoveryRunId: run,
          status: "review_required",
        })
        .where(eq(mcpConnections.pluginId, plugin.id))
        .run();
      return run;
    }
    await caller.plugins.mcp.accept({
      id: plugin.id,
      run: candidate([tool]),
      tools: [tool.name],
    });
    const run = await caller.runs.create({
      project: fixture.project.id,
      operation: "code",
      source: 'return customerTools.searchRecords({query: "test"});',
      idempotency_key: "original",
    });
    const before = fixture.store.db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id))
      .get();
    const revision = candidate([tool, { ...tool, name: "search-records" }]);
    await Promise.resolve(
      expect(
        caller.plugins.mcp.accept({
          id: plugin.id,
          run: revision,
          tools: ["invented"],
        }),
      ).rejects.toThrow("Select"),
    );
    await caller.plugins.mcp.accept({
      id: plugin.id,
      run: revision,
      tools: [tool.name, "search-records"],
    });
    const after = fixture.store.db
      .select()
      .from(runs)
      .where(eq(runs.id, run.id))
      .get();
    expect(after?.snapshot).toEqual(before?.snapshot);
    expect(after?.status).toBe("queued");
    const connection = await caller.plugins.mcp.get(plugin);
    expect(
      connection.catalogue.find((entry) => entry.name === tool.name)?.alias,
    ).toBe("searchRecords");
    expect(new Set(connection.catalogue.map((entry) => entry.alias)).size).toBe(
      2,
    );
    await caller.plugins.mcp.accept({
      id: plugin.id,
      run: candidate([tool]),
      tools: [],
    });
    expect(
      fixture.store.db.select().from(runs).where(eq(runs.id, run.id)).get()
        ?.status,
    ).toBe("cancelled");
    expect((await caller.plugins.get(plugin)).enabled).toBe(false);
    await Promise.resolve(
      expect(
        caller.plugins.mcp.accept({
          id: plugin.id,
          run: revision,
          tools: [tool.name],
        }),
      ).rejects.toThrow("Check"),
    );
  } finally {
    fixture.close();
  }
});

test("connections and credentials cannot cross workspace or plugin boundaries", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const foreignWorkspace = fixture.store.db
      .insert(workspaces)
      .values({ name: "Other", host: "other.example", createdAt: fixture.time })
      .returning()
      .get();
    const foreignProject = fixture.store.db
      .insert(projects)
      .values({
        ...fixture.project,
        id: crypto.randomUUID(),
        workspaceId: foreignWorkspace.id,
      })
      .returning()
      .get();
    await Promise.resolve(
      expect(
        caller.plugins.mcp.create({
          project: foreignProject.id,
          slug: "foreign",
          endpoint: "https://example.test/mcp",
        }),
      ).rejects.toThrow(/not found/i),
    );
    const plugin = await caller.plugins.mcp.create({
      project: fixture.project.id,
      slug: "private-tools",
      endpoint: "https://example.test/mcp",
      auth_mode: "headers",
      headers: { "X-API-Key": "synthetic-private-key" },
    });
    const stored = fixture.store.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, plugin.id))
      .get();
    if (!stored?.credentialId) {
      throw new Error("Missing fixture credential");
    }
    await Promise.resolve(
      expect(
        caller.plugins.create({
          project: fixture.project.id,
          slug: "inline-test",
          source: "return 1;",
          version: "1",
          credential: stored.credentialId,
        }),
      ).rejects.toThrow("belong"),
    );
    await Promise.resolve(
      expect(
        caller.credentials.update({
          id: stored.credentialId,
          secret: { headers: {} },
        }),
      ).rejects.toThrow("project plugins"),
    );
    await Promise.resolve(
      expect(
        caller.credentials.create({
          name: "fake",
          provider: "mcp-oauth",
          secret: { token: "synthetic" },
        }),
      ).rejects.toThrow("project plugins"),
    );
    fixture.store.db
      .update(mcpConnections)
      .set({ workspaceId: foreignWorkspace.id })
      .where(eq(mcpConnections.pluginId, plugin.id))
      .run();
    await Promise.resolve(
      expect(caller.plugins.mcp.get(plugin)).rejects.toThrow(/not found/i),
    );
    await Promise.resolve(
      expect(
        caller.plugins.mcp.update({
          id: plugin.id,
          endpoint: "https://new.example/mcp",
        }),
      ).rejects.toThrow(/not found/i),
    );
  } finally {
    fixture.close();
  }
});
test("replaced and removed connections delete their connection-owned credentials", async () => {
  const fixture = rpcFixture();
  try {
    const caller = fixture.caller();
    const plugin = await caller.plugins.mcp.create({
      project: fixture.project.id,
      slug: "cred-tools",
      endpoint: "https://mcp.example.test/tools",
      auth_mode: "headers",
      headers: { Authorization: "Bearer first-secret" },
    });
    const boundCredential = () =>
      fixture.store.db
        .select({ credentialId: plugins.credentialId })
        .from(plugins)
        .where(eq(plugins.id, plugin.id))
        .get()?.credentialId;
    const storedCredential = (id: string) =>
      fixture.store.db
        .select({ id: credentials.id })
        .from(credentials)
        .where(eq(credentials.id, id))
        .get();
    const original = boundCredential();
    if (!original) {
      throw new Error("Header credential missing after create");
    }
    await caller.plugins.mcp.update({
      id: plugin.id,
      headers: { Authorization: "Bearer second-secret" },
    });
    const replacement = boundCredential();
    if (!replacement) {
      throw new Error("Header credential missing after update");
    }
    expect(replacement).not.toBe(original);
    expect(storedCredential(original)).toBeUndefined();
    expect((await caller.plugins.mcp.get({ id: plugin.id })).authMode).toBe(
      "headers",
    );
    await caller.plugins.delete({ id: plugin.id });
    expect(storedCredential(replacement)).toBeUndefined();
  } finally {
    fixture.close();
  }
});
