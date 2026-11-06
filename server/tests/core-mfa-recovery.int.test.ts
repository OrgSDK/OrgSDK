import { expect, test } from "bun:test";
import { encrypt, digest } from "../shared/security";
import {
  client,
  loginOwner,
  sessionCookie,
  setup,
  store,
} from "./core-fixture";
test("recovery codes are single use and MFA sessions are challenged", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  const code = "one-time-code";
  s.sqlite
    .query("UPDATE users SET totp_secret=?, recovery_codes=? WHERE id=1")
    .run(encrypt(s, "JBSWY3DPEHPK3PXP"), JSON.stringify([digest(code)]));
  const challenge = client(s, cookie);
  const state = await challenge.auth.login({
    email: setup.email,
    password: setup.password1,
  });
  expect(state.is_authenticated).toBe(false);
  expect(state.flows).toEqual([{ id: "mfa_authenticate" }]);
  const pending = `${sessionCookie(challenge.ctx)}; csrftoken=test`;
  expect(
    (await client(s, pending).auth.mfaAuthenticate({ code })).is_authenticated,
  ).toBe(true);
  const second = client(s);
  await second.auth.login({ email: setup.email, password: setup.password1 });
  const secondCookie = `${sessionCookie(second.ctx)}; csrftoken=test`;
  await Promise.resolve(
    expect(
      client(s, secondCookie).auth.mfaAuthenticate({ code }),
    ).rejects.toThrow("Invalid authentication code"),
  );
  s.close();
});
