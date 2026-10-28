import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, owner, signIn, test } from "./fixtures";

async function submitCredentials(
  page: Page,
  credentials: { email: string; password: string },
  next = "/",
): Promise<void> {
  await page.goto(`/accounts/login/?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signOut(page: Page): Promise<void> {
  await page.goto("/accounts/logout/");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts\/login\//);
}

async function saveEmail(page: Page, email: string): Promise<void> {
  await page.goto("/accounts/email/");
  await expect(page.getByLabel("Email address")).not.toHaveValue("");
  await page.getByLabel("Email address").fill(email);
  const saved = page.waitForResponse((response) =>
    response.url().includes("/trpc/auth.changeEmail"),
  );
  await page.getByRole("button", { name: "Save email address" }).click();
  expect((await saved).status()).toBe(200);
}

async function savePassword(
  page: Page,
  current: string,
  next: string,
): Promise<void> {
  await page.goto("/accounts/password/change/");
  await page.getByLabel("Current password", { exact: true }).fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  const saved = page.waitForResponse((response) =>
    response.url().includes("/trpc/auth.changePassword"),
  );
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
}

function totpCode(secret: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const position = hash.readUInt8(19) & 15;
  return String((hash.readUInt32BE(position) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

test("wrong passwords stay signed out, local deep links survive sign-in, and logout revokes access", async ({
  page,
}) => {
  const next = "/documents/?source=authentication#saved-notes";
  await submitCredentials(
    page,
    { ...owner, password: "definitely-wrong-password" },
    next,
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
  ).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/accounts\/login\//);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL(next, page.url()).href);
  await expect(
    page.getByRole("heading", { name: "Documents & memory", level: 1 }),
  ).toBeVisible();
  await signOut(page);
  await page.goto(next);
  await expect(page).toHaveURL(/\/accounts\/login\/\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(next);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("account email and password changes persist and restore the shared owner credentials", async ({
  page,
}) => {
  test.setTimeout(60000);
  const changedEmail = "owner-updated@example.test";
  const changedPassword = "A-different-strong-test-password-456";
  let currentEmail = owner.email;
  let currentPassword = owner.password;
  await signIn(page, "/accounts/email/");
  try {
    await saveEmail(page, changedEmail);
    currentEmail = changedEmail;
    await expect(page.getByRole("status")).toHaveText("Email address saved.");
    await page.reload();
    await expect(page.getByLabel("Email address")).toHaveValue(changedEmail);
    await savePassword(page, owner.password, changedPassword);
    currentPassword = changedPassword;
    await expect(page.getByRole("status")).toHaveText(
      "Your password has been changed.",
    );
    await signOut(page);
    await submitCredentials(
      page,
      { email: changedEmail, password: owner.password },
      "/accounts/email/",
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
    ).toHaveText("Invalid email or password.");
    await page.getByLabel("Password", { exact: true }).fill(changedPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/accounts\/email\//);
    await expect(page.getByLabel("Email address")).toHaveValue(changedEmail);
  } finally {
    if (currentEmail !== owner.email || currentPassword !== owner.password) {
      await page.context().clearCookies();
      await submitCredentials(
        page,
        { email: currentEmail, password: currentPassword },
        "/accounts/email/",
      );
      await expect(page).toHaveURL(/\/accounts\/email\//);
      if (currentPassword !== owner.password) {
        await savePassword(page, currentPassword, owner.password);
      }
      if (currentEmail !== owner.email) {
        await saveEmail(page, owner.email);
      }
    }
  }
  await signOut(page);
  await signIn(page, "/accounts/email/");
  await expect(page.getByLabel("Email address")).toHaveValue(owner.email);
});

test("a separate account enrolls TOTP, resumes login challenges, consumes recovery codes once, and removes MFA", async ({
  page,
}) => {
  test.setTimeout(60000);
  const suffix = crypto.randomUUID();
  const credentials = {
    email: `mfa-${suffix}@example.test`,
    password: "A-secondary-strong-password-123",
  };
  await page.goto("/accounts/signup/?next=%2Faccounts%2F2fa%2F");
  await page.getByLabel("Username").fill(`mfa-${suffix}`);
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/accounts\/2fa\//);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = await page.locator("code").innerText();
  await page.getByLabel("Code from your authenticator").fill(totpCode(secret));
  await page
    .getByRole("button", {
      name: "Enable two-factor authentication",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Two-factor authentication is enabled.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate new recovery codes" })
    .click();
  const recovery = (
    await page.getByLabel("Recovery codes", { exact: true }).innerText()
  )
    .trim()
    .split("\n");
  expect(recovery).toHaveLength(10);
  const [firstRecovery, secondRecovery] = recovery;
  if (!firstRecovery || !secondRecovery) {
    throw new Error("Expected recovery codes from the enrollment screen.");
  }
  for (const code of recovery) {
    expect(code).toMatch(/^[\da-f]{16}$/);
  }
  await signOut(page);
  await submitCredentials(page, credentials, "/accounts/2fa/");
  await expect(
    page.getByLabel("Authentication or recovery code"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Authentication or recovery code"),
  ).toBeVisible();
  await page.getByLabel("Authentication or recovery code").fill("invalid-code");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid authentication code." }),
  ).toHaveText("Invalid authentication code.");
  // Enrollment consumed the current counter. The server accepts the next counter
  // in its clock-skew window, so this tests login without waiting for a new step.
  await page
    .getByLabel("Authentication or recovery code")
    .fill(totpCode(secret, 1));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/accounts\/2fa\//);
  await expect(
    page.getByText("Two-factor authentication is enabled.", { exact: true }),
  ).toBeVisible();
  await signOut(page);
  await submitCredentials(page, credentials, "/accounts/2fa/");
  await page.getByLabel("Authentication or recovery code").fill(firstRecovery);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/accounts\/2fa\//);
  await signOut(page);
  await submitCredentials(page, credentials, "/accounts/2fa/");
  await page.getByLabel("Authentication or recovery code").fill(firstRecovery);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid authentication code." }),
  ).toHaveText("Invalid authentication code.");
  await page.getByLabel("Authentication or recovery code").fill(secondRecovery);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/\/accounts\/2fa\//);
  await page
    .locator("summary")
    .filter({ hasText: "Disable two-factor authentication" })
    .click();
  await page
    .getByRole("button", {
      name: "Disable two-factor authentication",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Set up authenticator" }),
  ).toBeVisible();
});
