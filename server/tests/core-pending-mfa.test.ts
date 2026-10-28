import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("pending MFA sessions are revoked when the password changes", async () => {
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
  s.sqlite
    .query(
      "INSERT INTO sessions (id,pending_user_id,expires_at) VALUES ('pending',1,?)",
    )
    .run(Date.now() + 300000);
  const result = await call(
    s,
    req(
      "/api/auth/browser/v1/account/password/change",
      "POST",
      {
        current_password: setup.password1,
        new_password: "different strong password",
      },
      cookie,
    ),
  );
  expect(result.response.status).toBe(200);
  expect(
    s.sqlite.query("SELECT id FROM sessions WHERE id='pending'").get(),
  ).toBeNull();
  s.close();
});
