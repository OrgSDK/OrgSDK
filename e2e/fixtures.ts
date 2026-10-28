import { expect, test as base, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const owner = {
  email: "admin@example.test",
  password: "A-strong-test-password-123",
};

export const test = base.extend({
  page: async ({ page }, use) => {
    const retiredRequests: string[] = [];
    const browserErrors: string[] = [];
    page.on("request", (request) => {
      if (/^\/api(?:\/|$)/.test(new URL(request.url()).pathname)) {
        retiredRequests.push(request.url());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await use(page);
    expect(
      retiredRequests,
      "The frontend must use the typed tRPC API.",
    ).toEqual([]);
    expect(browserErrors, "Browser runtime errors.").toEqual([]);
  },
});
export { expect };

const savedSession = z.object({
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
    }),
  ),
});

export async function signIn(page: Page, next = "/"): Promise<void> {
  const directory = process.env.ORGSDK_E2E_DATA_DIR;
  const statePath = directory
    ? join(directory, "owner-browser-state.json")
    : undefined;
  if (statePath) {
    let state: z.infer<typeof savedSession> | undefined;
    try {
      const stored: unknown = JSON.parse(await readFile(statePath, "utf8"));
      state = savedSession.parse(stored);
    } catch {
      // A fresh installation has no saved browser session yet.
    }
    if (state) {
      await page.context().addCookies(state.cookies);
      const client = await testClient(page);
      const session = await client.auth.session.query();
      if (session.is_authenticated && session.user?.email === owner.email) {
        await page.goto(next);
        return;
      }
      await page.context().clearCookies();
    }
  }
  await page.goto(`/accounts/login/?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/accounts\/login/);
  if (statePath) {
    await page.context().storageState({ path: statePath });
  }
}

export async function testClient(page: Page) {
  const { createTypedClient } = await import("../frontend/src/api/trpc");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "csrftoken",
  )?.value;
  const requestFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const response = await page.request.fetch(request.url, {
        method: request.method,
        headers: (() => {
          const headers: Record<string, string> = {};
          request.headers.forEach((value, name) => {
            headers[name] = value;
          });
          return headers;
        })(),
        ...(["GET", "HEAD"].includes(request.method)
          ? {}
          : { data: await request.text() }),
      });
      return new Response(new Uint8Array(await response.body()), {
        status: response.status(),
        headers: response.headers(),
      });
    },
    { preconnect() {} },
  );
  return createTypedClient({
    url: `${process.env.ORGSDK_E2E_URL ?? "http://127.0.0.1:18783"}/trpc`,
    fetch: requestFetch,
    csrfToken: () => csrf,
  });
}
