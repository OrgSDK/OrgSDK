import { expect, signIn, test, testClient } from "./fixtures";
import { invitationUrl, waitForInvitationMail } from "./mailbox";

test("an invited account accepts membership and the owner can update and remove its access", async ({
  page,
  browser,
}) => {
  await signIn(page, "/people/");
  const ownerClient = await testClient(page);
  const email = "browser-accepted-member@example.test";
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
  const link = new URL(invitationUrl(await waitForInvitationMail(email)));
  expect(link.origin).toBe(new URL(page.url()).origin);
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const retiredRequests: string[] = [];
  const browserErrors: string[] = [];
  memberPage.on("request", (request) => {
    if (/^\/api(?:\/|$)/.test(new URL(request.url()).pathname)) {
      retiredRequests.push(request.url());
    }
  });
  memberPage.on("pageerror", (error) => browserErrors.push(error.message));
  try {
    const next = `${link.pathname}${link.search}`;
    await memberPage.goto(
      `${link.origin}/accounts/signup/?next=${encodeURIComponent(next)}`,
    );
    await memberPage
      .getByLabel("Username", { exact: true })
      .fill("browser_invited_member");
    await memberPage.getByLabel("Email address", { exact: true }).fill(email);
    await memberPage
      .getByLabel("Password", { exact: true })
      .fill("Independent-member-password-123");
    await memberPage
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(memberPage).toHaveURL(link.href);
    await memberPage
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(memberPage).toHaveURL(`${link.origin}/`);
    await expect(
      memberPage
        .getByRole("combobox", { name: "Project", exact: true })
        .first(),
    ).toBeVisible();
    const memberClient = await testClient(memberPage);
    expect((await memberClient.workspace.current.query()).role).toBe("member");
    await memberPage.goto(`${link.origin}/settings/`);
    await expect(
      memberPage.getByText("Your role: member", { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByLabel("Workspace name", { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    const role = page.getByRole("combobox", {
      name: `Role for ${email}`,
      exact: true,
    });
    await expect(role).toHaveValue("member");
    expect(
      (await ownerClient.workspace.current.query()).invitations.find(
        (item) => item.email === email,
      )?.accepted_at,
    ).toBeTruthy();
    await role.selectOption("admin");
    await expect(
      page.getByText("Member role updated.", { exact: true }),
    ).toBeVisible();
    await expect(role).toHaveValue("admin");
    expect(
      (await ownerClient.workspace.current.query()).members.find(
        (item) => item.email === email,
      )?.role,
    ).toBe("admin");
    await memberPage.reload();
    await expect(
      memberPage.getByText("Your role: admin", { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByLabel("Workspace name", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `Remove ${email}`, exact: true })
      .click();
    await page
      .getByRole("alertdialog", { name: "Remove this member?" })
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(role).toHaveCount(0);
    expect(
      (await ownerClient.workspace.current.query()).members.some(
        (item) => item.email === email,
      ),
    ).toBe(false);
    await memberPage.reload();
    await expect(
      memberPage
        .getByRole("alert")
        .filter({ hasText: "not a member of this workspace" }),
    ).toBeVisible();
  } finally {
    await memberContext.close();
    expect(
      retiredRequests,
      "The invited member UI must use native tRPC.",
    ).toEqual([]);
    expect(browserErrors, "Invited member browser runtime errors.").toEqual([]);
  }
});
