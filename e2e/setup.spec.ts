import { expect, owner, test } from "./fixtures";

test("fresh installation sets up the workspace through typed tRPC", async ({
  page,
}) => {
  await page.goto("/");
  const setup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Set up this installation" }).click();
  const installation = await setup;
  await expect(installation).toHaveURL(/\/setup\//);
  await installation.getByLabel("Workspace name").fill("Test workspace");
  await installation.getByLabel("Username").fill("testadmin");
  await installation.getByLabel("Email", { exact: true }).fill(owner.email);
  await installation
    .getByLabel("Password", { exact: true })
    .fill(owner.password);
  await installation.getByLabel("Confirm password").fill(owner.password);
  const created = installation.waitForResponse((response) =>
    response.url().includes("/trpc/auth.setup?"),
  );
  await installation.getByRole("button", { name: "Create workspace" }).click();
  expect((await created).status()).toBe(200);
  await expect(
    installation.getByText("Your workspace is ready. Sign in to get started."),
  ).toBeVisible();
  await installation.reload();
  await expect(
    installation.getByText("This server is already set up."),
  ).toBeVisible();
});
