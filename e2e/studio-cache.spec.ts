import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("Studio keeps a complete release offline and switches only after the last tab closes", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "orgsdk-studio-cache-"));
  const exported = resolve("frontend/dist/studio");
  await cp(exported, directory, { recursive: true });
  let offline = false;
  let interruptDownload = true;
  let mixed = false;
  const types: Record<string, string> = {
    js: "text/javascript",
    html: "text/html",
    css: "text/css",
    txt: "text/plain",
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (offline || (interruptDownload && path === "/monaco/vs/loader.js")) {
      response.writeHead(503).end();
      return;
    }
    const file = path.endsWith("/") ? path + "index.html" : path;
    const root = mixed && path === "/" ? exported : directory;
    void readFile(join(root, file)).then(
      (body) => {
        response
          .writeHead(200, {
            "Content-Type":
              types[file.split(".").at(-1) ?? ""] ?? "application/octet-stream",
            "Cache-Control": "no-store",
          })
          .end(body);
      },
      () => response.writeHead(404).end(),
    );
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing Studio test port.");
    }
    const origin = "http://127.0.0.1:" + String(address.port);
    // Keep automatic discovery away from installations on the developer’s computer.
    await context.route(
      /^http:\/\/127\.0\.0\.1:(?:2894[0-7]|8080)\//,
      (route) => route.abort(),
    );
    await page.goto(origin);
    await page.getByRole("button", { name: "Allow local connections" }).click();
    await expect(
      page.getByRole("heading", { name: "Get started with Studio" }),
    ).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry offline download" });
    await expect(retry).toBeVisible();
    interruptDownload = false;
    await retry.click();
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    const first = await page.evaluate(() => caches.keys());
    expect(first).toHaveLength(1);
    offline = true;
    await page.goto(origin + "/actions/?project=offline");
    await expect(
      page.getByRole("button", { name: "Try connecting again" }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => (await fetch("/monaco/vs/loader.js")).ok),
    ).toBe(true);
    expect(
      await page.evaluate(
        async () => (await fetch("/trpc/system.health")).status,
      ),
    ).toBe(503);
    offline = false;
    const secondTab = await context.newPage();
    await secondTab.goto(origin);
    const html = join(directory, "index.html");
    await writeFile(
      html,
      (await readFile(html, "utf8")) + "<!-- next-studio-release -->",
    );
    execFileSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/build-studio-cache.ts",
      directory,
    ]);
    mixed = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const rejected = new Promise<void>((done) =>
        registration.addEventListener(
          "updatefound",
          () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "redundant") {
                done();
              }
            });
          },
          { once: true },
        ),
      );
      await registration.update();
      await rejected;
    });
    expect(
      await page.evaluate(async () =>
        (await (await fetch("/")).text()).includes("next-studio-release"),
      ),
    ).toBe(false);
    mixed = false;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(
      page.getByRole("status").filter({ hasText: "A Studio update is ready" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.close();
    expect(
      await secondTab.evaluate(async () =>
        (await (await fetch("/")).text()).includes("next-studio-release"),
      ),
    ).toBe(false);
    await secondTab.close();
    offline = true;
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await expect
      .poll(() =>
        reopened.evaluate(async () =>
          (await (await fetch("/")).text()).includes("next-studio-release"),
        ),
      )
      .toBe(true);
    const keys = await reopened.evaluate(() => caches.keys());
    expect(keys).toHaveLength(1);
    expect(keys).not.toEqual(first);
  } finally {
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
