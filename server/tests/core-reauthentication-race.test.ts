import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("identity confirmation cannot revive a revoked session during password verification", async () => {
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
    const confirmation = call(
      s,
      req(
        "/api/auth/browser/v1/auth/reauthenticate",
        "POST",
        { password: setup.password1 },
        cookie,
      ),
    );
    await started;
    s.sqlite.query("DELETE FROM sessions").run();
    release();
    await Promise.resolve(
      expect(confirmation).rejects.toThrow("session has expired"),
    );
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
