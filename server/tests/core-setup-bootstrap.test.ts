import { expect, test } from "bun:test";
import { client, setup, store } from "./core-fixture";
test("session bootstrap directs a fresh install to setup", async () => {
  const s = store();
  expect(await client(s).auth.setupStatus()).toMatchObject({
    setup_required: true,
    hostname: "localhost",
  });
  await Promise.resolve(
    expect(client(s).auth.session()).rejects.toThrow("Set up your workspace"),
  );
  expect(await client(s).auth.setup(setup)).toEqual({
    setup_required: false,
    login_url: "/accounts/login/",
  });
  expect(await client(s).auth.session()).toEqual({
    is_authenticated: false,
    user: null,
  });
  s.close();
});
