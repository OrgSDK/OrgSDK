import { expect, test } from "bun:test";
import { client, loginOwner, setup, store } from "./core-fixture";
test("identity confirmation cannot revive a revoked session during password verification", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  const original = Bun.password.verify;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    Bun.password.verify = async (...args: Parameters<typeof original>) => {
      const result = await original(...args);
      entered();
      await gate;
      return result;
    };
    const pending = client(s, cookie).auth.reauthenticate({
      password: setup.password1,
    });
    await started;
    s.sqlite.query("DELETE FROM sessions").run();
    release();
    await Promise.resolve(
      expect(pending).rejects.toThrow("session has expired"),
    );
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
