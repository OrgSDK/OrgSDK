import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, openWorkspace, signIn, test, testClient } from "./fixtures";

test("Studio runs a saved session-only version between two cells", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signIn(page);
  const client = await testClient(page);
  const project = await client.projects.create.mutate({
    name: "Session action project",
  });
  const action = await client.actions.saveAction.mutate({
    project: project.id,
    name: "Finish in session",
    source: "return actionParams.name;",
  });
  const registration = await client.projects.connectExecutor.mutate({
    id: project.id,
    locally_managed: false,
  });
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-studio-session-"));
  const executable = process.env.ORGSDK_E2E_BUN ?? "bun";
  const cli = resolve("runtime/src/cli.ts");
  const origin = process.env.ORGSDK_E2E_URL ?? "http://127.0.0.1:18783";
  try {
    await promisify(execFile)(
      executable,
      [cli, "register", "--url", origin, "--data", directory],
      { env: { PATH: process.env.PATH, EXECUTOR_TOKEN: registration.token } },
    );
    const runner = spawn(
      executable,
      [cli, "start", "--mode", "host", "--data", directory],
      { stdio: "ignore", env: { PATH: process.env.PATH } },
    );
    const ended = once(runner, "exit");
    try {
      await openWorkspace(
        page,
        `/actions/?project=${project.id}&action=${action.action}`,
      );
      await page.getByRole("tab", { name: "Execution", exact: true }).click();
      await page.getByRole("combobox", { name: "Run mode" }).click();
      await page
        .getByRole("option", { name: "Session only", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save version", exact: true })
        .click();
      await expect(page.getByText("Version 2 saved.")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Run selected version", exact: true }),
      ).toBeDisabled();
      await page.getByRole("tab", { name: "Session", exact: true }).click();
      await page
        .getByRole("button", { name: "Open session", exact: true })
        .click();
      const panel = page.getByRole("tabpanel", {
        name: "Session",
        exact: true,
      });
      await expect(panel.getByText("Session idle.")).toBeVisible({
        timeout: 20000,
      });
      await panel
        .getByLabel("TypeScript cell")
        .fill("const seed = 41; return seed;");
      await panel.getByRole("button", { name: "Execute cell" }).click();
      await expect(panel.locator("output")).toHaveText("41", {
        timeout: 20000,
      });
      await panel
        .getByRole("button", { name: "Run selected version in session" })
        .click();
      await expect(panel.locator("output")).toHaveText('"team"', {
        timeout: 20000,
      });
      await panel.getByLabel("TypeScript cell").fill("return seed + 1;");
      await panel.getByRole("button", { name: "Execute cell" }).click();
      await expect(panel.locator("output")).toHaveText("42", {
        timeout: 20000,
      });
      await panel.getByRole("button", { name: "Close session" }).click();
      await expect(panel.locator("output")).toHaveText("Session closed.", {
        timeout: 20000,
      });
    } finally {
      runner.kill("SIGTERM");
      await ended;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
