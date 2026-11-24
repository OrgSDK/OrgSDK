import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { signIn, openWorkspace, testClient, test, expect } from "./fixtures";

test("review a Shell invocation and manage executable rules in Studio", async ({
  page,
}) => {
  test.setTimeout(60000);
  const directory = process.env.ORGSDK_E2E_DATA_DIR;
  if (!directory) {
    throw new Error("Disposable installation required.");
  }
  const catalogPath = join(directory, "plugin-catalog.json");
  const previous = await readFile(catalogPath);
  const release = {
    slug: "shell",
    version: "0.3.0",
    digest: "a".repeat(64),
    distribution: "external",
    package_url: "https://fixture.invalid/shell.mjs",
    display_name: "Shell",
    description: "Project executable checks",
    category: "Developer",
    documentation: "",
    contract_version: 1,
    auth: {},
    marketplace: {},
    configuration_schema: { type: "object" },
    tools: [
      {
        name: "run",
        parameters: [],
        metadata: { approval: "shell-executable" },
      },
    ],
  };
  await writeFile(catalogPath, JSON.stringify([release]));
  try {
    await signIn(page);
    const client = await testClient(page);
    const project = await client.projects.create.mutate({
      name: "Shell approvals",
    });
    const plugin = await client.plugins.create.mutate({
      project: project.id,
      slug: "shell",
      version: release.version,
      distribution: "external",
    });
    const executor = await client.projects.connectExecutor.mutate({
      id: project.id,
      locally_managed: false,
    });
    const origin = process.env.ORGSDK_E2E_URL;
    const wire = async (path: string, token: string, data: unknown) => {
      const response = await page.request.post(
        origin + "/internal/execution/v1/" + path,
        { headers: { Authorization: "Bearer " + token }, data },
      );
      expect(response.ok(), path).toBe(true);
      return response;
    };
    await wire("register/", executor.token, {
      protocol_version: 4,
      capabilities: ["code"],
    });
    const run = await client.runs.create.mutate({
      project: project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "shell-browser",
    });
    const job = z
      .object({ capability: z.string(), run_id: z.uuid() })
      .parse(await (await wire("claim/", executor.token, {})).json());
    expect(job.run_id).toBe(run.id);
    const invoke = async (name: string) =>
      z.object({ id: z.uuid().optional(), status: z.string() }).parse(
        await (
          await wire("product/shell/" + plugin.id + "/", job.capability, {
            executable: name,
            args: ["-p"],
          })
        ).json(),
      );
    expect((await invoke("uptime")).status).toBe("pending");
    expect((await client.runs.get.query({ id: run.id })).status).toBe(
      "waiting_approval",
    );
    await openWorkspace(page, "/approvals/");
    const card = page
      .locator(".approval-card")
      .filter({ hasText: project.name });
    await expect(card).toContainText('["uptime","-p"]');
    await card.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(await client.plugins.shellRules.query({ id: plugin.id })).toEqual(
      [],
    );
    expect((await client.runs.get.query({ id: run.id })).status).toBe(
      "running",
    );
    expect((await invoke("uptime")).status).toBe("pending");
    await card.getByRole("button", { name: "Always allow uptime" }).click();
    await expect(card).toHaveCount(0);
    expect((await invoke("uptime")).status).toBe("approved");
    expect((await invoke("uname")).status).toBe("pending");
    await card.getByRole("button", { name: "Block uname" }).click();
    await expect(card).toHaveCount(0);
    expect((await invoke("uname")).status).toBe("denied");
    await openWorkspace(page, "/plugins/?project=" + project.id);
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    const policy = page.getByRole("region", { name: "Executable policy" });
    await expect(policy).toContainText("Blocked");
    await policy
      .getByRole("button", { name: "Ask next time for uname" })
      .click();
    await expect(policy.getByText("uname", { exact: true })).toHaveCount(0);
    await policy.getByLabel("Executable name").fill("df");
    await policy.getByRole("button", { name: "Save rule" }).click();
    await expect(policy.getByText("df", { exact: true })).toBeVisible();
    expect((await invoke("df")).status).toBe("approved");
    expect((await invoke("uname")).status).toBe("pending");
    await client.runs.cancel.mutate({ id: run.id });
  } finally {
    await writeFile(catalogPath, previous);
  }
});
