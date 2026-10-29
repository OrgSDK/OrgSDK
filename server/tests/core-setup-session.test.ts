import { expect, test } from "bun:test";
import { requireWorkspace } from "../shared/authorization";
import { client, loginOwner, setup, store } from "./core-fixture";
test("setup is atomic and login rotates session; foreign hosts cannot access it", async () => {
  const s = store();
  expect(await client(s).auth.setup(setup)).toMatchObject({
    setup_required: false,
  });
  expect(
    s.sqlite.query("select count(*) as count from projects").get(),
  ).toEqual({ count: 1 });
  await Promise.resolve(
    expect(client(s).auth.setup(setup)).rejects.toThrow("already complete"),
  );
  const login = await loginOwner(s);
  expect(login.result.is_authenticated).toBe(true);
  const foreign = client(s, login.cookie, "other.local");
  expect(() => requireWorkspace(foreign.ctx)).toThrow();
  expect((await client(s, login.cookie).auth.session()).is_authenticated).toBe(
    true,
  );
  const next = await loginOwner(s);
  expect(next.session).not.toBe(login.session);
  s.close();
});
