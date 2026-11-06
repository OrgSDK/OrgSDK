import { expect, test } from "bun:test";
import { createContext } from "../http/context";
import { handleOAuthCallback } from "../oauth/transport";
import { fakeFetch, fixture, request } from "./oauth-fixture";
test("OAuth reports generic provider errors and burns the one-time state", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost";
  const f = fixture();
  try {
    const begin = await f.caller().credentials.beginOAuth({
      plugin: f.id,
      name: "Google",
      client_id: "client-id",
      client_secret: "client-secret",
    });
    const url = new URL(begin.authorization_url);
    const callback = `/oauth/callback?state=${url.searchParams.get("state")}&code=bad`;
    const ctx = () =>
      createContext(
        request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
        f.store,
      );
    await Promise.resolve(
      expect(
        handleOAuthCallback(
          ctx(),
          fakeFetch(
            () => new Response("provider exposed secret", { status: 500 }),
          ),
        ),
      ).rejects.toThrow("OAuth token exchange failed"),
    );
    await Promise.resolve(
      expect(handleOAuthCallback(ctx())).rejects.toThrow("expired"),
    );
  } finally {
    f.close();
    if (before === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = before;
    }
  }
});
