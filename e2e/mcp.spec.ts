import { expect, signIn, test, testClient } from "./fixtures";
import { prepareExecutor } from "./executor";
import { mcpSmokeServer } from "../scripts/mcp-smoke-server";

test("connects, reviews and runs remote MCP tools through project plugins", async ({
  page,
}) => {
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "Remote MCP browser proof",
  });
  const executor = await prepareExecutor(page, project.id, 4);
  const remote = await mcpSmokeServer();
  try {
    await page.goto(`/plugins/?project=${project.id}`);
    await page
      .getByLabel("Connection name", { exact: true })
      .fill("customer-tools");
    await page.getByLabel("Server URL", { exact: true }).fill(remote.endpoint);
    await page
      .getByRole("combobox", { name: "Authentication", exact: true })
      .selectOption("headers");
    await page
      .getByLabel("Bearer token", { exact: true })
      .fill("package-mcp-secret");
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    const card = page.getByRole("article", { name: "MCP customer-tools" });
    await expect(card).toBeVisible();
    const plugin = (await client.plugins.list.query()).results.find(
      (entry) => entry.project === project.id && entry.distribution === "mcp",
    );
    if (!plugin) {
      throw new Error("MCP plugin missing");
    }
    await card
      .getByRole("button", { name: "Check connection / refresh tools" })
      .click();
    await expect
      .poll(
        async () =>
          (await client.plugins.mcp.get.query({ id: plugin.id }))
            .discoveryRunId,
      )
      .not.toBeNull();
    const discovery = await client.plugins.mcp.get.query({ id: plugin.id });
    if (!discovery.discoveryRunId) {
      throw new Error("Discovery not queued");
    }
    await executor.execute(discovery.discoveryRunId);
    await expect(
      card.getByRole("heading", { name: "Review available tools" }),
    ).toBeVisible();
    expect(remote.calls).toBe(0);
    await card.getByRole("checkbox").check();
    await card.getByRole("button", { name: "Enable selected tools" }).click();
    await expect(
      card.getByText("Enabled · 1 tools selected", { exact: true }),
    ).toBeVisible();
    const source =
      'return await customerTools.searchRecords({ query: "browser" });';
    const run = await client.runs.create.mutate({
      project: project.id,
      operation: "code",
      source,
      idempotency_key: crypto.randomUUID(),
    });
    await executor.execute(run.id);
    expect((await client.runs.get.query({ id: run.id })).output).toMatchObject({
      result: { structuredContent: { found: true } },
    });
    expect(remote.calls).toBe(1);
    await card.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(
      card.getByText("Disabled · 1 tools selected", { exact: true }),
    ).toBeVisible();
  } finally {
    await remote.close();
  }
});
