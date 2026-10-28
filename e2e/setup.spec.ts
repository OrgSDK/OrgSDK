import { expect, owner, test } from "./fixtures";

test("fresh installation sets up the workspace through typed tRPC", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup\//);
  await page.getByLabel("Workspace name").fill("Test workspace");
  await page.getByLabel("Username").fill("testadmin");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByLabel("Confirm password").fill(owner.password);
  const created = page.waitForResponse((response) =>
    response.url().includes("/trpc/auth.setup?"),
  );
  await page.getByRole("button", { name: "Create workspace" }).click();
  expect((await created).status()).toBe(200);
  await expect(
    page.getByText("Your workspace is ready. Sign in to get started."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("This server is already set up.")).toBeVisible();
});
