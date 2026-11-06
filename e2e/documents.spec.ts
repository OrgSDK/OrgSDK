import { expect, signIn, test, testClient } from "./fixtures";

test("document saves update the same record and protect unsaved edits", async ({
  page,
}) => {
  await signIn(page, "/documents/");
  const client = await testClient(page);
  const title = "Document save regression";
  const selector = page.getByRole("combobox", {
    name: "Document",
    exact: true,
  });
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Content").fill("First version");

  let releaseSave: (() => void) | undefined;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/trpc/documents.create*", async (route) => {
    await pendingSave;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(selector).toBeDisabled();
    await expect(page.getByLabel("Content")).toBeDisabled();
  } finally {
    releaseSave?.();
  }
  await expect(
    page.getByText("Document saved.", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/trpc/documents.create*");
  const savedId = await selector.inputValue();
  expect(savedId).not.toBe("");
  await page.getByLabel("Content").fill("Updated version");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(
    page.getByText("Document saved.", { exact: true }),
  ).toBeVisible();
  const documents = (await client.documents.list.query()).results.filter(
    (document) => document.title === title,
  );
  expect(documents).toHaveLength(1);
  expect(documents[0]?.id).toBe(savedId);
  expect(documents[0]?.content).toBe("Updated version");

  await page.getByLabel("Content").fill("Unsaved draft");
  await page.route("**/trpc/documents.update*", (route) => route.abort());
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.locator(".error[role=alert]")).toBeVisible();
  await expect(page.getByLabel("Content")).toHaveValue("Unsaved draft");
  await expect(
    page.getByRole("button", { name: "Save document" }),
  ).toBeEnabled();
  await page.unroute("**/trpc/documents.update*");
  await selector.selectOption("");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(selector).toHaveValue(savedId);
  await expect(page.getByLabel("Content")).toHaveValue("Unsaved draft");
  await page.getByRole("link", { name: "Workspace home", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/documents\//);
  await expect(page.getByLabel("Content")).toHaveValue("Unsaved draft");
  await selector.selectOption("");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Content")).toHaveValue("");
  await selector.selectOption(savedId);
  await expect(page.getByLabel("Content")).toHaveValue("Updated version");
});
