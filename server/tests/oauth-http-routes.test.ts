import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { plugins } from "../db/schema";
import { fixture, request } from "./oauth-fixture";
test("HTTP connection route is wired and rejects an untrusted provider", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
  const f = await fixture();
  try {
    const { createApp } = await import("../app");
    const app = createApp(f.store);
    const makeRequest = () =>
      request(
        "/api/v1/credentials/oauth-connect/",
        "POST",
        {
          plugin: f.id,
          name: "Google",
          client_id: "client-id",
          client_secret: "client-secret",
        },
        `${f.cookie}; csrftoken=test`,
      );
    const response = await app(makeRequest());
    expect(response.status).toBe(200);
    expect(new URL((await response.json()).authorization_url).hostname).toBe(
      "accounts.google.com",
    );
    const plugin = f.store.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, f.id))
      .get()!;
    f.store.db
      .update(plugins)
      .set({
        releaseMetadata: {
          ...plugin.releaseMetadata,
          auth: {
            type: "oauth2",
            provider: "https://internal.example/token",
            scopes: ["email"],
          },
        },
      })
      .where(eq(plugins.id, f.id))
      .run();
    expect((await app(makeRequest())).status).toBe(400);
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
