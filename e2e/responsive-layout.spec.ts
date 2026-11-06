import { expect, signIn, test, testClient } from "./fixtures";

test("webhook page navigation assets are served separately from delivery endpoints", async ({
  request,
}) => {
  for (const path of ["/webhooks/__next._tree.txt", "/webhooks/index.txt"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
  }
  const delivery = await request.get(`/webhooks/${crypto.randomUUID()}`);
  expect(delivery.status()).toBe(405);
});

test("long project names and workspace screens fit narrow viewports", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "CustomerReconciliationAndReportingForInternationalOperationsWithoutSpaces",
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/",
      `/projects/?project=${project.id}`,
      `/actions/?project=${project.id}`,
      `/connections/?project=${project.id}`,
      "/tables/",
      "/documents/",
      "/settings/",
    ]) {
      await page.goto(route);
      const header = page.locator(".workspace-header");
      await expect(header).toBeVisible();
      await expect(
        page.getByText("Loading workspace data…", { exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      expect(
        await header.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll("button, strong")]
            .filter((item) => item.getBoundingClientRect().width > 0)
            .every((item) => {
              const rectangle = item.getBoundingClientRect();
              return (
                rectangle.top >= bounds.top && rectangle.bottom <= bounds.bottom
              );
            });
        }),
        `Header controls must fit at ${String(width)}px on ${route}`,
      ).toBe(true);
    }
  }
});

test("action header controls do not overlap at tablet widths", async ({
  page,
}) => {
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "Layout project",
  });
  const saved = await client.actions.saveAction.mutate({
    project: project.id,
    name: "Daily customer reconciliation and summary report",
    source: "return 1;",
    input_schema: { type: "object" },
    output_schema: { type: "number" },
  });
  await client.runs.create.mutate({
    project: project.id,
    action: saved.action,
    operation: "action",
    version: saved.version.number,
    inputs: {},
    idempotency_key: crypto.randomUUID(),
  });
  await page.goto(`/actions/?project=${project.id}&action=${saved.action}`);
  await expect(page.locator(".action-last-run")).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.locator(".action-toolbar").evaluate((element) => {
        const navigation = element
          .querySelector(".action-breadcrumb")
          ?.getBoundingClientRect();
        const controls = element
          .querySelector(".action-header-controls")
          ?.getBoundingClientRect();
        if (!navigation || !controls) {
          return false;
        }
        return (
          navigation.right <= controls.left || navigation.bottom <= controls.top
        );
      }),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Run selected version" }),
    ).toBeVisible();
  }
});

test("mobile navigation locks background scrolling and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator(".workspace-sidebar")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await page
    .getByRole("button", { name: /Projects.*installed plugins/ })
    .click();
  await expect(page).toHaveURL(/\/projects\//);
});
