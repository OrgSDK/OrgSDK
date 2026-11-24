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
  const connections = reopened.getByRole("button", {
    name: "Saved servers for Test workspace",
  });
  const saved = reopened.getByRole("dialog", { name: "Saved servers" });
  const connect = reopened.getByRole("link", {
    name: "Connect to a different server",
  });
  await expect(connect).toHaveCount(0);

  const previousServer = "https://previous.example.test";
  await reopened.evaluate((endpoint) => {
    localStorage.setItem(
      "orgsdk:studio-grant:" + endpoint,
      JSON.stringify({ token: "expired-test-grant", expiresAt: 0 }),
    );
  }, previousServer);

  await reopened.setViewportSize({ width: 390, height: 844 });
  await reopened.getByRole("button", { name: "Open navigation" }).click();
  await connections.click();
  await expect(saved.getByText("Connected", { exact: true })).toBeVisible();
  await expect(saved.getByText(previousServer, { exact: true })).toBeVisible();
  await reopened.keyboard.press("Escape");
  await expect(saved).not.toBeVisible();
  await expect(connections).toBeFocused();
  await reopened.setViewportSize({ width: 1280, height: 800 });
  await connections.click();
  const popup = reopened.waitForEvent("popup");
  await connect.click();
  await expect((await popup).getByLabel("Server address")).toHaveValue("");

  await reopened.goto(studio + "/documents/");
  await reopened.getByLabel("Content").fill("Unsaved server switch draft");
  await connections.click();
  const switchServer = saved.getByRole("button", {
    name: "Switch to " + previousServer,
  });
  await switchServer.click();
  await reopened.getByRole("button", { name: "Keep editing" }).click();
  await expect(saved).toBeVisible();
  await switchServer.click();
  await reopened.getByRole("button", { name: "Discard changes" }).click();
  await expect(reopened.getByLabel("Server address")).toHaveValue(
    previousServer,
  );

  await reopened.goto(studio);
  await connections.click();
  await saved.getByRole("button", { name: "Remove " + previousServer }).click();
  await expect(saved.getByText(previousServer, { exact: true })).toHaveCount(0);
  await reopened.reload();
  await connections.click();
  await expect(saved.getByText(previousServer, { exact: true })).toHaveCount(0);
  await saved.getByRole("button", { name: "Sign out of Studio" }).click();
  await expect(reopened.getByLabel("Email address")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email address")).toBeVisible();
});
