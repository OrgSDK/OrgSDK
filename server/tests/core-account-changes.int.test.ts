import { expect, test } from "bun:test";
import { client, loginOwner, setup, store } from "./core-fixture";
test("account changes require fresh identity and logout revokes the session", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  s.sqlite.query("UPDATE sessions SET reauthenticated_at=0").run();
  await Promise.resolve(
    expect(
      client(s, cookie).auth.changeEmail({ email: "new@example.com" }),
    ).rejects.toThrow("Confirm your identity"),
  );
  expect(
    (await client(s, cookie).auth.reauthenticate({ password: setup.password1 }))
      .is_authenticated,
  ).toBe(true);
  expect(
    await client(s, cookie).auth.changeEmail({ email: "new@example.com" }),
  ).toEqual([{ email: "new@example.com", primary: true, verified: false }]);
  expect((await client(s, cookie).auth.logout()).is_authenticated).toBe(false);
  expect((await client(s, cookie).auth.session()).is_authenticated).toBe(false);
  s.close();
});
