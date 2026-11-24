import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, openWorkspace, signIn, test, testClient } from "./fixtures";

test("configure Browser CDP without JSON in a modal opened from the catalogue", async ({
  page,
}) => {
  const directory = process.env.ORGSDK_E2E_DATA_DIR;
  if (!directory) {
    throw new Error("Disposable installation required.");
  }
  const catalogue = join(directory, "plugin-catalog.json");
  const previous = await readFile(catalogue);
  const release = {
    slug: "browser-cdp",
    version: "0.1.3",
    digest: "a".repeat(64),
    distribution: "external",
    package_url: "https://fixture.invalid/browser-cdp.mjs",
    display_name: "Browser CDP",
    description: "Control a remote Chrome browser over CDP.",
    category: "Developer",
    documentation: "",
    contract_version: 1,
    auth: { type: "token", provider: "browser-cdp" },
    marketplace: {},
    configuration_schema: {
      type: "object",
      properties: {
        cdpEndpoint: { type: "string" },
        authMode: { type: "string" },
      },
      additionalProperties: false,
    },
    tools: [],
  };
  await writeFile(catalogue, JSON.stringify([release]));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const client = await testClient(page);
    const project = await client.projects.create.mutate({
      name: "Browser CDP settings",
    });
    await openWorkspace(page, "/plugins/?project=" + project.id);
    const listing = page.getByRole("article", {
      name: "Browser CDP",
      exact: true,
    });
    await listing.getByRole("button", { name: "Enable plugin" }).click();
    const dialog = page.getByRole("dialog", { name: "Browser CDP" });
    const endpoint = dialog.getByRole("textbox", { name: "Browser endpoint" });
    const close = dialog.getByRole("button", { name: "Close plugin settings" });
    await expect(dialog).toBeInViewport();
    await expect(endpoint).toBeInViewport();
    await expect(dialog.getByText("Configuration (JSON)")).toHaveCount(0);
    await close.click();
    await expect(dialog).toHaveCount(0);

    const configure = listing.getByRole("button", { name: "Configure" });
    await configure.click();
    await expect(dialog).toBeInViewport();
    await endpoint.fill("ws://steel:3000");
    await page.keyboard.press("Escape");
    const discard = page.getByRole("alertdialog", {
      name: "Discard unsaved changes?",
    });
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(endpoint).toHaveValue("ws://steel:3000");
    await dialog.getByRole("button", { name: "Save plugin" }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Plugin saved for its project.",
    );
    const installed = (await client.plugins.list.query()).results.find(
      (plugin) => plugin.project === project.id && plugin.slug === release.slug,
    );
    expect(installed?.configuration).toEqual({
      cdpEndpoint: "ws://steel:3000",
    });
    await close.click();
    await expect(configure).toBeFocused();

    const inspect = page.getByRole("button", { name: "Inspect", exact: true });
    await inspect.click();
    await expect(endpoint).toHaveValue("ws://steel:3000");
    await endpoint.fill("http://localhost:9222");
    await close.click();
    await discard.getByRole("button", { name: "Discard changes" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(inspect).toBeFocused();
    await inspect.click();
    await expect(endpoint).toHaveValue("ws://steel:3000");
  } finally {
    await writeFile(catalogue, previous);
  }
});
