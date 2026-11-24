import { z } from "zod";
import { expect, signIn, test } from "./fixtures";

test("the workspace update buttons are reachable and require an explicit confirmation", async ({
  page,
}) => {
  let confirmed = false;
  await page.route("**/trpc/**", async (route) => {
    const request = route.request();
    const paths = new URL(request.url()).pathname
      .slice("/trpc/".length)
      .split(",");
    if (request.method() === "POST" && paths.includes("system.requestUpdate")) {
      expect(paths).toEqual(["system.requestUpdate"]);
      expect(JSON.parse(request.postData() ?? "{}")).toEqual({
        "0": { version: "9.0.0" },
      });
      confirmed = true;
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": new URL(page.url()).origin },
        json: [{ result: { data: { version: "9.0.0" } } }],
      });
      return;
    }
    const index = paths.indexOf("system.updateStatus");
    if (request.method() !== "GET" || index < 0) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const batch = z.array(z.unknown()).parse(await response.json());
    batch[index] = {
      result: {
        data: {
          installed: confirmed ? "9.0.0" : "8.0.0",
          available: confirmed ? null : "9.0.0",
          checked: true,
          automatic: true,
          executorReady: true,
          pending: null,
          failed: null,
        },
      },
    };
    await route.fulfill({ response, json: batch });
  });
  await signIn(page);
  const notice = page.getByRole("complementary", {
    name: "Installation update",
  });
  await notice.getByRole("button", { name: "Update and restart" }).click();
  expect(confirmed).toBe(false);
  await notice
    .getByRole("button", { name: "Confirm update and restart" })
    .click();
  await expect(
    page.getByText(
      "OrgSDK 9.0.0 is running and its local executor manager has reconnected.",
    ),
  ).toBeVisible();
  expect(confirmed).toBe(true);
});
