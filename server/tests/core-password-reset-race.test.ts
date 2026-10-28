import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("password verification cannot restore a session after an operator resets the password", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  const original = Bun.password.verify;
  let release!: () => void, entered!: () => void;
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
    const login = call(
      s,
      req("/api/auth/browser/v1/auth/login", "POST", {
        email: setup.email,
        password: setup.password1,
      }),
    );
    await started;
    s.sqlite
      .query("UPDATE users SET password_hash=? WHERE id=1")
      .run("reset-hash");
    release();
    await Promise.resolve(expect(login).rejects.toThrow("account changed"));
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
