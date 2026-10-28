import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("account changes require fresh identity and logout revokes the session", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  const login = await call(
    s,
    req("/api/auth/browser/v1/auth/login", "POST", {
      email: setup.email,
      password: setup.password1,
    }),
  );
  const session = login.ctx.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const cookie = `${session}; csrftoken=test`;
  s.sqlite.query("UPDATE sessions SET reauthenticated_at=0").run();
  await Promise.resolve(
    expect(
      call(
        s,
        req(
          "/api/auth/browser/v1/account/email",
          "POST",
          { email: "new@example.com" },
          cookie,
        ),
      ),
    ).rejects.toThrow("Confirm your identity"),
  );
  const confirmed = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/reauthenticate",
      "POST",
      { password: setup.password1 },
      cookie,
    ),
  );
  expect(confirmed.response.status).toBe(200);
  const changed = await call(
    s,
    req(
      "/api/auth/browser/v1/account/email",
      "POST",
      { email: "new@example.com" },
      cookie,
    ),
  );
  expect(changed.response.status).toBe(200);
  const logout = await call(
    s,
    req("/api/auth/browser/v1/auth/session", "DELETE", undefined, cookie),
  );
  expect(logout.response.status).toBe(401);
  const current = await call(
    s,
    req("/api/v1/session/", "GET", undefined, session),
  );
  expect((await current.response.json()).is_authenticated).toBe(false);
  s.close();
});
