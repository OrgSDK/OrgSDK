import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("recovery codes are single use and MFA sessions are challenged", async () => {
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
  const { encrypt, digest } = await import("../shared/security");
  const code = "one-time-code";
  s.sqlite
    .query("UPDATE users SET totp_secret=?, recovery_codes=? WHERE id=1")
    .run(encrypt(s, "JBSWY3DPEHPK3PXP"), JSON.stringify([digest(code)]));
  const challenge = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/login",
      "POST",
      { email: setup.email, password: setup.password1 },
      cookie,
    ),
  );
  expect(challenge.response.status).toBe(401);
  const pending = challenge.ctx.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const verify = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/2fa/authenticate",
      "POST",
      { code },
      `${pending}; csrftoken=test`,
    ),
  );
  expect(verify.response.status).toBe(200);
  const challenge2 = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/login",
      "POST",
      { email: setup.email, password: setup.password1 },
      cookie,
    ),
  );
  const pending2 = challenge2.ctx.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  expect(
    (
      await call(
        s,
        req(
          "/api/auth/browser/v1/auth/2fa/authenticate",
          "POST",
          { code },
          `${pending2}; csrftoken=test`,
        ),
      )
    ).response.status,
  ).toBe(400);
  s.close();
});
