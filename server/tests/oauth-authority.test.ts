import { expect, test } from "bun:test";
import { credentials } from "../db/schema";
import { createContext } from "../http/context";
import { handleOAuth } from "../oauth/routes";
import { fakeFetch, fixture, request } from "./oauth-fixture";
test("OAuth rejects unsafe origin, mismatched session and changed membership during exchange", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  const f = await fixture();
  try {
    const start = () =>
      createContext(
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
    process.env.ORGSDK_PUBLIC_ORIGIN = "https://attacker.example";
    await Promise.resolve(
      expect(handleOAuth(start())).rejects.toThrow("must match"),
    );
    process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
    const begin = await handleOAuth(start());
    const url = new URL((await begin!.json()).authorization_url);
    const state = url.searchParams.get("state");
    const callback = `/api/v1/credentials/oauth-callback/?state=${state}&code=test`;
    const ctx = createContext(
      request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
      f.store,
    );
    const response = handleOAuth(
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
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
