import { expect, test } from "bun:test";
import { createContext } from "../http/context";
import { handleOAuth } from "../oauth/routes";
import { fakeFetch, fixture, request } from "./oauth-fixture";
test("OAuth reports generic provider errors and burns the one-time state", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
  const f = await fixture();
  try {
    const start = createContext(
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
      ),
      f.store,
    );
    const url = new URL(
      (await (await handleOAuth(start))!.json()).authorization_url,
    );
    const callback = `/api/v1/credentials/oauth-callback/?state=${url.searchParams.get("state")}&code=bad`;
    const ctx = () =>
      createContext(
        request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
        f.store,
      );
    await Promise.resolve(
      expect(
        handleOAuth(
          ctx(),
          fakeFetch(
            () => new Response("provider exposed secret", { status: 500 }),
          ),
        ),
      ).rejects.toThrow("OAuth token exchange failed"),
    );
    await Promise.resolve(
      expect(handleOAuth(ctx())).rejects.toThrow("expired"),
    );
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
