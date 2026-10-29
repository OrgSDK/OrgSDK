import type { Page } from "@playwright/test";
import { expect, signIn, test, testClient } from "./fixtures";

async function prepareControls(page: Page, name: string) {
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: `${name} project`,
  });
  const saved = await client.actions.saveAction.mutate({
    project: project.id,
    name: `${name} action`,
    source: "return 1;",
    input_schema: { type: "object" },
    output_schema: { type: "number" },
  });
  const parameters = new URLSearchParams({
    project: project.id,
    action: saved.action,
  });
  return { client, project, saved, parameters };
}

test("create, edit, pause and delete an action schedule through the browser", async ({
  page,
}) => {
  const { client, saved, parameters } = await prepareControls(
    page,
    "Schedule controls",
  );
  await page.goto(`/schedules/?${parameters.toString()}`);
  await page.getByLabel("Time (UTC)").fill("04:15");
  await page.getByLabel("Scheduled inputs (JSON)").fill('{"iteration":1}');
  await page
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(
    page.getByText("Schedule saved.", { exact: true }),
  ).toBeVisible();
  const row = page.locator(".resource-row").filter({
    has: page.getByRole("link", {
      name: "Schedule controls action",
      exact: true,
    }),
  });
  await expect(row).toBeVisible();
  const schedule = (await client.schedules.list.query()).results.find(
    (item) => item.action === saved.action,
  );
  if (!schedule) {
    throw new Error("The browser-created schedule was not persisted.");
  }
  expect(schedule.cron).toBe("15 4 * * 1-5");
  expect(schedule.inputs).toEqual({ iteration: 1 });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Time (UTC)").fill("06:45");
  await page.getByLabel("Scheduled inputs (JSON)").fill('{"iteration":2}');
  await page
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create a schedule", exact: true }),
  ).toBeVisible();
  expect((await client.schedules.get.query({ id: schedule.id })).cron).toBe(
    "45 6 * * 1-5",
  );
  expect(
    (await client.schedules.get.query({ id: schedule.id })).inputs,
  ).toEqual({ iteration: 2 });
  await row.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(row).toContainText("Paused");
  expect((await client.schedules.get.query({ id: schedule.id })).enabled).toBe(
    false,
  );
  await page.reload();
  await expect(
    row.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: "Delete schedule", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Delete this schedule?" })
    .getByRole("button", { name: "Delete schedule", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    (await client.schedules.list.query()).results.some(
      (item) => item.id === schedule.id,
    ),
  ).toBe(false);
});

test("register, disable and rotate a webhook while clearing one-time secrets", async ({
  page,
}) => {
  const { client, saved, parameters } = await prepareControls(
    page,
    "Webhook controls",
  );
  await page.goto(`/webhooks/?${parameters.toString()}`);
  await page.getByLabel("Name", { exact: true }).fill("Browser webhook");
  await page
    .getByRole("button", { name: "Register webhook", exact: true })
    .click();
  const secretPanel = page.getByRole("region", {
    name: "One-time webhook secret",
  });
  await expect(secretPanel).toBeVisible();
  const initialSecret = await secretPanel
    .getByLabel("Secret", { exact: true })
    .inputValue();
  expect(initialSecret.length).toBeGreaterThan(20);
  const hook = (await client.webhooks.list.query()).results.find(
    (item) => item.action_id === saved.action,
  );
  if (!hook) {
    throw new Error("The browser-created webhook was not persisted.");
  }
  expect(
    JSON.stringify(await client.webhooks.get.query({ id: hook.id })),
  ).not.toContain(initialSecret);
  expect(JSON.stringify(await client.webhooks.list.query())).not.toContain(
    initialSecret,
  );
  await secretPanel.getByRole("button", { name: "Dismiss secret" }).click();
  await expect(secretPanel).toHaveCount(0);
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Browser webhook", exact: true }),
  });
  await card.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(card.getByText("Disabled", { exact: true })).toBeVisible();
  expect((await client.webhooks.get.query({ id: hook.id })).enabled).toBe(
    false,
  );
  await card
    .getByRole("button", { name: "Rotate secret", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Rotate webhook secret?" })
    .getByRole("button", { name: "Rotate secret", exact: true })
    .click();
  await expect(secretPanel).toBeVisible();
  const rotatedSecret = await secretPanel
    .getByLabel("Secret", { exact: true })
    .inputValue();
  expect(rotatedSecret).not.toBe(initialSecret);
  expect(rotatedSecret.length).toBeGreaterThan(20);
  expect(
    JSON.stringify(await client.webhooks.get.query({ id: hook.id })),
  ).not.toContain(rotatedSecret);
  expect(JSON.stringify(await client.webhooks.list.query())).not.toContain(
    rotatedSecret,
  );
  await secretPanel.getByRole("button", { name: "Dismiss secret" }).click();
  await page.reload();
  await expect(secretPanel).toHaveCount(0);
  await expect(card.getByText("Disabled", { exact: true })).toBeVisible();
});

test("inspect, update and remove a prepared inline plugin through the browser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { client, project } = await prepareControls(page, "Plugin controls");
  const plugin = await client.plugins.create.mutate({
    project: project.id,
    slug: "browser-inline",
    version: "1",
    source: "export const safeFunctions = [];",
  });
  await page.goto(`/plugins/?project=${project.id}`);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByLabel("Plugin slug", { exact: true })).toHaveValue(
    "browser-inline",
  );
  await page.getByLabel("Plugin version", { exact: true }).fill("2");
  const source =
    'export const safeFunctions = [{name:"hello", handler:()=>"hello"}];';
  await page
    .getByRole("textbox", { name: "Plugin source", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source);
  await page.getByRole("button", { name: "Save plugin", exact: true }).click();
  await expect(
    page.getByText("Plugin saved for its project.", { exact: true }),
  ).toBeVisible();
  const updated = await client.plugins.get.query({ id: plugin.id });
  expect(updated.version).toBe("2");
  expect(updated.source).toBe(source);
  expect(updated.digest).not.toBe(plugin.digest);
  await page.reload();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByLabel("Plugin version", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    page.getByRole("textbox", { name: "Plugin source", exact: true }).first(),
  ).toBeVisible();
  expect((await client.plugins.get.query({ id: plugin.id })).source).toBe(
    source,
  );
  await page
    .getByRole("button", { name: "Remove plugin", exact: true })
    .click();
  await page
    .getByRole("alertdialog", { name: "Remove this plugin?" })
    .getByRole("button", { name: "Remove plugin", exact: true })
    .click();
  await expect(
    page.getByText("No plugins installed", { exact: true }),
  ).toBeVisible();
  expect(
    (await client.plugins.list.query()).results.some(
      (item) => item.id === plugin.id,
    ),
  ).toBe(false);
});

test("issue an exact-version client token, clear its secret and revoke access", async ({
  page,
}) => {
  const { client, project, saved } = await prepareControls(
    page,
    "Token controls",
  );
  await page.goto(`/connections/?project=${project.id}`);
  await page
    .getByLabel("Client name", { exact: true })
    .fill("Browser scoped client");
  await page
    .getByRole("combobox", { name: "Permission preset", exact: true })
    .selectOption("runner");
  await page
    .getByRole("checkbox", {
      name: `Token controls action · version 1 · ${project.name}`,
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  const secretField = page.getByLabel("New access token", { exact: true });
  await expect(secretField).not.toHaveValue("");
  const secret = await secretField.inputValue();
  const token = (await client.tokens.list.query()).results.find(
    (item) => item.name === "Browser scoped client",
  );
  if (!token) {
    throw new Error("The browser-created scoped token was not persisted.");
  }
  expect(token.projects).toEqual([]);
  expect(token.action_versions).toEqual([saved.version.id]);
  expect(token.scopes).toEqual([
    "catalog:read",
    "actions:run",
    "runs:read",
    "runs:cancel",
  ]);
  expect(
    JSON.stringify(await client.tokens.get.query({ id: token.id })),
  ).not.toContain(secret);
  expect(JSON.stringify(await client.tokens.list.query())).not.toContain(
    secret,
  );
  await page
    .getByRole("button", { name: "Dismiss token", exact: true })
    .click();
  await expect(secretField).toHaveCount(0);
  await page.reload();
  await expect(secretField).toHaveCount(0);
  const row = page
    .locator(".resource-row")
    .filter({ has: page.getByText("Browser scoped client", { exact: true }) });
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Revoke this client's access?" })
    .getByRole("button", { name: "Revoke token", exact: true })
    .click();
  await expect(row).toContainText("revoked");
  expect((await client.tokens.get.query({ id: token.id })).revoked).toBe(true);
  await expect(
    row.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
});
