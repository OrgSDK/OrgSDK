import { expect, test } from "bun:test";
import { client, loginOwner, setup, store } from "./core-fixture";
test("pending MFA sessions are revoked when the password changes", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  s.sqlite
    .query(
      "INSERT INTO sessions (id,pending_user_id,expires_at) VALUES ('pending',1,?)",
    )
    .run(Date.now() + 300000);
  expect(
    (
      await client(s, cookie).auth.changePassword({
        current_password: setup.password1,
        new_password: "different strong password",
      })
    ).is_authenticated,
  ).toBe(true);
  expect(
    s.sqlite.query("SELECT id FROM sessions WHERE id='pending'").get(),
  ).toBeNull();
  s.close();
});
