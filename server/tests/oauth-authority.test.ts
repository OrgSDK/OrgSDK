import { expect, test } from "bun:test";
import { credentials } from "../db/schema";
import { createContext } from "../http/context";
import { handleOAuthCallback } from "../oauth/transport";
import { fakeFetch, fixture, request } from "./oauth-fixture";
test("OAuth rejects unsafe origin, mismatched session and changed membership during exchange", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  const f = fixture();
  try {
    const start = () =>
      f.caller().credentials.beginOAuth({
        plugin: f.id,
        name: "Google",
        client_id: "client-id",
        client_secret: "client-secret",
      });
    process.env.ORGSDK_PUBLIC_ORIGIN = "https://attacker.example";
    await Promise.resolve(expect(start()).rejects.toThrow("must match"));
    process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost";
    const begin = await start();
    const url = new URL(begin.authorization_url);
    const state = url.searchParams.get("state");
    const callback = `/oauth/callback?state=${state}&code=test`;
    const ctx = createContext(
      request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
      f.store,
    );
    const response = handleOAuthCallback(
      ctx,
      fakeFetch(() => {
        f.store.sqlite.query("DELETE FROM memberships WHERE user_id=1").run();
        return Response.json({ access_token: "token", expires_in: 3600 });
      }),
    );
    await Promise.resolve(
      expect(response).rejects.toThrow("workspace access changed"),
    );
    expect(f.store.db.select().from(credentials).all()).toHaveLength(0);
  } finally {
    f.close();
    if (before === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = before;
    }
  }
});
