import { invitationUrl, waitForInvitationMail } from "./mailbox";
import { expect, signIn, test, testClient } from "./fixtures";

test("workspace settings persist a renamed workspace and restore its original name", async ({
  page,
}) => {
  await signIn(page, "/settings/");
  const client = await testClient(page);
  const originalName = (await client.workspace.current.query()).workspace.name;
  try {
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill("Browser renamed workspace");
    await page
      .getByRole("button", { name: "Save workspace name", exact: true })
      .click();
    await expect(
      page.getByText("Workspace name saved.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Workspace name", { exact: true }),
    ).toHaveValue("Browser renamed workspace");
    expect((await client.workspace.current.query()).workspace.name).toBe(
      "Browser renamed workspace",
    );
  } finally {
    await page.goto("/settings/");
    await page.getByLabel("Workspace name", { exact: true }).fill(originalName);
    await page
      .getByRole("button", { name: "Save workspace name", exact: true })
      .click();
    await expect(
      page.getByText("Workspace name saved.", { exact: true }),
    ).toBeVisible();
    expect((await client.workspace.current.query()).workspace.name).toBe(
      originalName,
    );
  }
});

test("invite and revoke a teammate using the local test mail sink", async ({
  page,
}) => {
  await signIn(page, "/people/");
  const client = await testClient(page);
  const email = "browser-invitation@example.test";
  await page.getByLabel("Invite by email", { exact: true }).fill(email);
  await page
    .getByRole("combobox", { name: "Invitation role", exact: true })
    .selectOption("member");
  await page
    .getByRole("button", { name: "Invite member", exact: true })
    .click();
  await expect(
    page.getByText("Invitation queued.", { exact: true }),
  ).toBeVisible();
  const row = page
    .locator(".resource-row")
    .filter({ has: page.getByText(email, { exact: true }) });
  await expect(row.getByText("Pending", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Invite by email", { exact: true })).toHaveValue(
    "",
  );
  const invitation = (await client.workspace.current.query()).invitations.find(
    (item) => item.email === email,
  );
  if (!invitation) {
    throw new Error("The browser-created invitation was not persisted.");
  }
  const message = await waitForInvitationMail(email);
  expect(new URL(invitationUrl(message)).origin).toBe(
    new URL(page.url()).origin,
  );
  expect(invitation.role).toBe("member");
  expect(invitation.revoked_at).toBeNull();
  expect(invitation).not.toHaveProperty("token");
  expect(invitation).not.toHaveProperty("token_digest");
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
  expect(
    (await client.workspace.current.query()).invitations.find(
      (item) => item.id === invitation.id,
    )?.revoked_at,
  ).toBeTruthy();
});

test("audit filters show the recorded actor and object for a browser-created credential", async ({
  page,
}) => {
  await signIn(page, "/credentials/");
  const client = await testClient(page);
  const session = await client.auth.session.query();
  if (!session.user) {
    throw new Error("The signed-in test owner is unavailable.");
  }
  const name = "Audit browser credential";
  const secret = "synthetic-administration-test-secret";
  await page.getByLabel("Credential name", { exact: true }).fill(name);
  await page.getByLabel("Provider", { exact: true }).fill("test-provider");
  await page
    .getByLabel("Secret JSON", { exact: true })
    .fill(JSON.stringify({ api_key: secret }));
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const credential = (await client.credentials.list.query()).results.find(
    (item) => item.name === name,
  );
  if (!credential) {
    throw new Error("The browser-created audit fixture was not persisted.");
  }
  await page.goto("/audit/");
  await page
    .getByLabel("Action / kind", { exact: true })
    .fill("credential.created");
  await page
    .getByLabel("Actor ID", { exact: true })
    .fill(String(session.user.id));
  await page.getByLabel("Object ID", { exact: true }).fill(credential.id);
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("1 matching events", { exact: true }),
  ).toBeVisible();
  const events = page.getByRole("list", { name: "Audit events", exact: true });
  await expect(events.getByRole("listitem")).toHaveCount(1);
  await expect(events).toContainText("credential.created");
  await expect(events).toContainText(`Actor ID ${session.user.id}`);
  await expect(events).toContainText(`Object: ${credential.id}`);
  await expect(events).not.toContainText(secret);
  await page
    .getByLabel("Action / kind", { exact: true })
    .fill("credential.deleted");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("No audit events match these filters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByLabel("Action / kind", { exact: true })).toHaveValue(
    "",
  );
  await expect(events).toContainText(credential.id);
});
