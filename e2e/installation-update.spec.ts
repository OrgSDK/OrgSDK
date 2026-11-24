import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, owner, reloadWorkspace, test } from "./fixtures";

const target = "9.0.0";
const installed = "8.0.0";

async function signInToStudio(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Allow local connections" }).click();
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".workspace-header")).toBeVisible();
}

async function stageUpdate(page: Page, { legacy = false } = {}) {
  const state = {
    requests: 0,
    installed,
    available: target as string | null,
    pending: null as string | null,
    failed: null as string | null,
    blockers: { running: 2, awaitingApproval: 1 } as
      { running: number; awaitingApproval: number } | undefined,
    online: true,
    executorReady: false,
    healthy: false,
    healthChecks: 0,
  };
  if (legacy) {
    state.blockers = undefined;
  }

  await page.route("**/trpc/**", async (route) => {
    const request = route.request();
    const paths = new URL(request.url()).pathname
      .slice("/trpc/".length)
      .split(",");
    const headers = {
      "access-control-allow-origin": new URL(page.url()).origin,
    };
    if (request.method() === "POST" && paths.includes("system.requestUpdate")) {
      expect(paths).toEqual(["system.requestUpdate"]);
      expect(JSON.parse(request.postData() ?? "{}")).toEqual({
        "0": { version: target },
      });
      state.requests++;
      state.pending = target;
      await route.fulfill({
        status: 200,
        headers,
        json: [{ result: { data: { version: target } } }],
      });
      return;
    }

    const statusIndex = paths.indexOf("system.updateStatus");
    const healthIndex = paths.indexOf("system.health");
    if (request.method() !== "GET" || (statusIndex < 0 && healthIndex < 0)) {
      await route.continue();
      return;
    }
    if (!state.online) {
      await route.abort("connectionrefused");
      return;
    }
    // Preserve the browser's Studio grant and exclude installation cookies.
    const grant = (await request.allHeaders())["x-orgsdk-studio-session"] ?? "";
    const response = await fetch(request.url(), {
      headers: {
        origin: new URL(page.url()).origin,
        "x-orgsdk-studio-session": grant,
      },
    });
    const batch = z.array(z.unknown()).parse(await response.json());
    if (statusIndex >= 0) {
      batch[statusIndex] = {
        result: {
          data: {
            installed: state.installed,
            available: state.available,
            pending: state.pending,
            failed: state.failed,
            blockers: state.blockers,
            checked: true,
            automatic: true,
            executorReady: state.executorReady,
          },
        },
      };
    }
    if (healthIndex >= 0) {
      state.healthChecks++;
      if (!state.healthy) {
        await route.abort("failed");
        return;
      }
    }
    await route.fulfill({ status: 200, headers, json: batch });
  });
  return state;
}

test("the update stays in one dialog through drain, restart and readiness checks", async ({
  page,
}) => {
  const state = await stageUpdate(page);
  await signInToStudio(page);
  const notice = page.getByRole("complementary", {
    name: "Installation update",
  });
  const offer = notice.getByRole("button", { name: "Click here to update" });
  const dialog = page.getByRole("alertdialog");
  await offer.click();
  await expect(dialog).toHaveAccessibleName(`Update to OrgSDK ${target}`);
  expect(state.requests).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(offer).toBeFocused();
  await offer.click();
  await dialog.getByRole("button", { name: "Update now" }).click();
  await expect(dialog).toHaveAccessibleName(
    "Waiting for actions to finish before restarting",
  );
  await expect(
    dialog.getByText("2 running · 1 awaiting approval"),
  ).toBeVisible();
  expect(state.requests).toBe(1);

  await dialog.getByRole("button", { name: "Review approvals" }).click();
  await expect(
    page.getByRole("heading", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await notice.getByRole("button", { name: "View update progress" }).click();
  await expect(dialog).toBeVisible();

  state.blockers = { running: 0, awaitingApproval: 0 };
  await expect(dialog).toHaveAccessibleName("Preparing to restart");
  state.online = false;
  await expect(dialog).toHaveAccessibleName("Waiting for OrgSDK to reconnect");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  state.online = true;
  state.installed = target;
  state.available = null;
  state.pending = null;
  state.healthy = true;
  await dialog.getByRole("button", { name: "Check again" }).click();
  await expect(dialog).toHaveAccessibleName("Checking that OrgSDK is ready");
  await expect(
    dialog.getByText(/waiting for the local executor/i),
  ).toBeVisible();

  state.healthy = false;
  state.executorReady = true;
  const checksBefore = state.healthChecks;
  await expect(
    dialog.getByText(/waiting for the platform health check/i),
  ).toBeVisible();
  expect(state.healthChecks).toBeGreaterThan(checksBefore);
  state.healthy = true;
  await expect(dialog).toHaveAccessibleName("You’re up to date!");
  await expect(
    dialog.getByText(
      /health check passed and the local executor is connected/i,
    ),
  ).toBeVisible();

  await dialog.getByRole("button", { name: "Back to workspace" }).click();
  await expect(dialog).toBeHidden();
  await expect(notice).toBeHidden();
  expect(state.requests).toBe(1);
});

test("after a reload Studio still tracks the requested version and shows a launcher failure", async ({
  page,
}) => {
  const state = await stageUpdate(page, { legacy: true });
  await signInToStudio(page);
  const dialog = page.getByRole("alertdialog");
  await page.getByRole("button", { name: "Click here to update" }).click();
  await dialog.getByRole("button", { name: "Update now" }).click();
  await expect(dialog).toHaveAccessibleName(
    "Waiting for actions to finish before restarting",
  );
  await reloadWorkspace(page);
  await expect(dialog).toHaveAccessibleName(
    "Waiting for actions to finish before restarting",
  );

  state.pending = null;
  state.failed = target;
  await expect(dialog).toHaveAccessibleName("The update couldn’t finish");
  await expect(
    dialog.getByText(/check the terminal where you started OrgSDK/i),
  ).toBeVisible();
  expect(state.healthChecks).toBe(0);
  expect(state.requests).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Click here to update" }),
  ).toBeVisible();
});
