import { expect, owner, test } from "./fixtures";

test("a fresh local workspace opens in Studio and reconnects on refresh and reopen", async ({
  page,
  context,
}) => {
  await page.goto("/documents/");
  const studio = process.env.ORGSDK_E2E_STUDIO;
  if (!studio) {
    throw new Error("Studio test origin is required.");
  }
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(new URL(frame.url()).origin);
    }
  });
  await page.getByRole("button", { name: "Allow local connections" }).click();
  await page.getByLabel("Workspace name").fill("Test workspace");
  await page.getByLabel("Username").fill("testadmin");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByLabel("Confirm password").fill(owner.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.locator(".workspace-header")).toBeVisible();
  await expect(page).toHaveURL(studio + "/documents/");
  await page.reload();
  await expect(page.locator(".workspace-header")).toBeVisible();
  expect(navigations.every((origin) => origin === studio)).toBe(true);
  const reopened = await context.newPage();
  await reopened.goto(studio);
  await expect(reopened.locator(".workspace-header")).toBeVisible();
  const popup = reopened.waitForEvent("popup");
  await reopened
    .getByRole("link", { name: "Connect to a different server" })
    .click();
  await expect((await popup).getByLabel("Server address")).toHaveValue("");
  await reopened.getByRole("button", { name: "Sign out of Studio" }).click();
  await expect(reopened.getByLabel("Email address")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email address")).toBeVisible();
});
