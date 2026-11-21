import { expect, owner, test, testClient } from "./fixtures";
import { prepareExecutor } from "./executor";

test("fresh local setup signs in and guides the owner to a verified project run", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup\//);
  await page.getByLabel("Workspace name").fill("Test workspace");
  await page.getByLabel("Username").fill("testadmin");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("12345678");
  await page.getByLabel("Confirm password").fill("12345678");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(password).toBeFocused();
  await expect(password).toHaveAccessibleDescription(/at least 8 characters/);
  await password.fill(owner.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
  await page.getByLabel("Confirm password").fill(owner.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Get your project running" }),
  ).toBeVisible();
  const check = page.getByRole("button", { name: "Run installation check" });
  await expect(check).toBeDisabled();
  const client = await testClient(page);
  const [project] = (await client.projects.list.query()).results;
  if (!project) {
    throw new Error("Setup did not create the first project.");
  }
  expect(project.name).toBe("My project");
  await expect(
    page.getByRole("link", { name: "Runner settings" }),
  ).toHaveAttribute("href", `/projects/?project=${project.id}&tab=runner`);
  const executor = await prepareExecutor(page, project.id);
  await expect(check).toBeEnabled({ timeout: 15000 });
  await check.click();
  await expect(page).toHaveURL(/\/runs\/\?.*run=/);
  const runId = new URL(page.url()).searchParams.get("run");
  if (!runId) {
    throw new Error("Missing installation check run.");
  }
  await executor.execute(runId);
  await expect(page.locator(".run-detail .status-succeeded")).toBeVisible();
  await expect(page.locator(".run-detail")).toContainText("Runner ready");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "View successful run" }),
  ).toBeVisible();
  await page.goto("/setup/");
  await expect(page.getByText("This server is already set up.")).toBeVisible();
});
