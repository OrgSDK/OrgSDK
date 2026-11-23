import { expect, test } from "./fixtures";

test("Studio guides an empty computer through installation and discovers it on retry", async ({
  page,
  context,
}) => {
  const studio = process.env.ORGSDK_E2E_STUDIO;
  if (!studio) {
    throw new Error("Studio test origin is required.");
  }
  const responding = new Set<string>();
  const seen = new Set<string>();
  await context.route("http://127.0.0.1:2894*/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/studio/approve/") {
      await route.fulfill({
        contentType: "text/plain",
        body: "Test installation",
      });
      return;
    }
    expect(url.pathname).toBe("/trpc/studio.discover");
    seen.add(url.port);
    if (!responding.has(url.port)) {
      await route.abort();
      return;
    }
    await route.fulfill({
      json: [
        {
          result: {
            data: { product: "orgsdk", protocol: 1, audience: studio },
          },
        },
      ],
    });
  });
  await page.goto(studio);
  await expect(
    page.getByRole("heading", { name: "Get started with Studio" }),
  ).toBeVisible();
  expect(seen.size).toBe(8);
  await expect(page.getByRole("img", { name: "OrgSDK" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to app" })).toHaveCount(0);
  await expect(page.locator("pre")).toHaveText(
    "npm install -g @orgsdk/cli\norgsdk start",
  );
  for (const port of ["28941", "28944"]) {
    responding.add(port);
  }
  await page.getByRole("button", { name: "Try connecting again" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose an installation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "http://127.0.0.1:28944" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "http://127.0.0.1:28941" }).click();
  await expect(page).toHaveURL(
    /^http:\/\/127\.0\.0\.1:28941\/studio\/approve\/#\w{64}$/,
  );
});

test("a hosted server link waits for the user and offers local setup after a connection error", async ({
  page,
  context,
}) => {
  const studio = process.env.ORGSDK_E2E_STUDIO;
  if (!studio) {
    throw new Error("Studio test origin is required.");
  }
  const remote = "https://installation.example.test";
  let requests = 0;
  await context.route(remote + "/**", async (route) => {
    requests++;
    await route.abort();
  });
  await context.route("http://127.0.0.1:2894*/**", (route) => route.abort());
  await page.goto(studio + "/?server=" + encodeURIComponent(remote));
  await expect(page.getByLabel("Server address")).toHaveValue(remote);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Connect to server" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Studio couldn’t reach that server" }),
  ).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Find OrgSDK on this computer" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Get started with Studio" }),
  ).toBeVisible();
});
