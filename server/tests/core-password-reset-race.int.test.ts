import { expect, test } from "bun:test";
import { client, setup, store } from "./core-fixture";
test("password verification cannot restore a session after an operator resets the password", async () => {
  const s = store();
  await client(s).auth.setup(setup);
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
    const pending = client(s).auth.login({
      email: setup.email,
      password: setup.password1,
    });
    await started;
    s.sqlite
      .query("UPDATE users SET password_hash=? WHERE id=1")
      .run("reset-hash");
    release();
    await Promise.resolve(expect(pending).rejects.toThrow("account changed"));
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
