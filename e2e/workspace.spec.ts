import { expect, signIn, test } from "./fixtures";

test("manage projects, documents, credentials, tables and immutable actions through tRPC", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/projects/?new=1");
  await page.getByLabel("Project name").fill("Browser test project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/\?project=/);
  await expect(
    page.getByRole("option", { name: "Browser test project" }),
  ).toHaveCount(1);
  await page.goto("/documents/");
  await page.getByLabel("Title").fill("Test notes");
  await page.getByLabel("Content").fill("Saved through the typed client.");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByRole("option", { name: /Test notes/ })).toHaveCount(1);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Document", exact: true })
    .selectOption({ label: "Test notes · document" });
  await expect(page.getByLabel("Content")).toHaveValue(
    "Saved through the typed client.",
  );
  await page.goto("/credentials/");
  await page.getByLabel("Credential name").fill("Browser credential");
  await page
    .getByLabel("Secret JSON", { exact: true })
    .fill(JSON.stringify({ api_key: "synthetic-e2e-credential" }));
  const createdCredential = page.waitForResponse((response) =>
    response.url().includes("/trpc/credentials.create"),
  );
  await page.getByRole("button", { name: "Save credential" }).click();
  const credentialResponse = await createdCredential;
  expect(credentialResponse.status()).toBe(200);
  expect(await credentialResponse.text()).not.toContain(
    "synthetic-e2e-credential",
  );
  await expect(
    page.getByText("Browser credential", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Secret JSON", { exact: true })).toHaveValue("");
  await page.reload();
  await page
    .locator(".resource-row")
    .filter({ has: page.getByText("Browser credential", { exact: true }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Credential name").fill("Renamed credential");
  const renamedCredential = page.waitForResponse((response) =>
    response.url().includes("/trpc/credentials.update"),
  );
  await page.getByRole("button", { name: "Save credential" }).click();
  expect((await renamedCredential).status()).toBe(200);
  await expect(
    page.getByText("Renamed credential", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete credential Renamed credential" })
    .click();
  const deletedCredential = page.waitForResponse((response) =>
    response.url().includes("/trpc/credentials.delete"),
  );
  await page
    .getByRole("alertdialog", { name: "Delete this credential?" })
    .getByRole("button", { name: "Delete credential", exact: true })
    .click();
  expect((await deletedCredential).status()).toBe(200);
  await expect(
    page.getByText("Renamed credential", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/tables/");
  await page.getByLabel("Table name").fill("Measurements");
  await page.getByLabel("Column 1 key").fill("amount");
  await page.getByLabel("Type", { exact: true }).selectOption("number");
  await page.getByRole("button", { name: "Save table" }).click();
  await expect(page.getByRole("option", { name: "Measurements" })).toHaveCount(
    1,
  );
  await page
    .getByLabel("Table", { exact: true })
    .selectOption({ label: "Measurements" });
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByLabel("amount (required)").fill("42.5");
  await page.getByRole("button", { name: "Save row" }).click();
  await expect(page.getByText("42.5")).toBeVisible();
  await page.goto("/actions/");
  await page.getByRole("link", { name: "New action" }).click();
  await page.getByLabel("Action name").fill("Browser action");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(
    page.getByRole("combobox", { name: "Action version" }),
  ).toContainText("Version 1");
  await page.getByRole("button", { name: "Run selected version" }).click();
  await expect(
    page.getByText("Run queued. Follow its progress and results below."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "TypeScript source" })
    .first()
    .focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// Updated in browser");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(
    page.getByRole("combobox", { name: "Action version" }),
  ).toContainText("Version 2");
  await page
    .getByLabel("Project", { exact: true })
    .first()
    .selectOption({ label: "My project" });
  await expect(page).not.toHaveURL(/action=/);
});

test("signed-out mobile deep link redirects to sign in", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/documents/?example=1");
  await expect(page).toHaveURL(/\/accounts\/login\/\?next=/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await context.close();
});

test("tRPC denies anonymous reads and mutations without CSRF", async ({
  request,
}) => {
  const read = await request.get("/trpc/projects.list");
  expect(read.status()).toBe(401);
  const write = await request.post("/trpc/projects.create", {
    data: { name: "Denied" },
  });
  expect(write.status()).toBe(403);
});
