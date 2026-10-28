import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("TOTP codes cannot be replayed across login challenges and failures are throttled", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  const { encrypt } = await import("../shared/security");
  const { createHmac } = await import("node:crypto");
  s.sqlite
    .query("UPDATE users SET totp_secret=? WHERE id=1")
    .run(encrypt(s, "JBSWY3DPEHPK3PXP"));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", Buffer.from("48656c6c6f21deadbeef", "hex"))
    .update(counter)
    .digest();
  const offset = mac[19]! & 15;
  const code = String(
    (mac.readUInt32BE(offset) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
  async function challenge() {
    const result = await call(
      s,
      req("/api/auth/browser/v1/auth/login", "POST", {
        email: setup.email,
        password: setup.password1,
      }),
    );
    expect(result.response.status).toBe(401);
    return result.ctx.responseHeaders
      .getSetCookie()
      .find((x) => x.startsWith("sessionid="))!
      .split(";")[0]!;
  }
  const first = await challenge(),
    second = await challenge();
  expect(
    (
      await call(
        s,
        req(
          "/api/auth/browser/v1/auth/2fa/authenticate",
          "POST",
          { code },
          `${first}; csrftoken=test`,
        ),
      )
    ).response.status,
  ).toBe(200);
  expect(
    (
      await call(
        s,
        req(
          "/api/auth/browser/v1/auth/2fa/authenticate",
          "POST",
          { code },
          `${second}; csrftoken=test`,
        ),
      )
    ).response.status,
  ).toBe(400);
  for (let index = 0; index < 8; index++)
    expect(
      (
        await call(
          s,
          req(
            "/api/auth/browser/v1/auth/2fa/authenticate",
            "POST",
            { code: "bad" },
            `${second}; csrftoken=test`,
          ),
        )
      ).response.status,
    ).toBe(400);
  await Promise.resolve(
    expect(
      call(
        s,
        req(
          "/api/auth/browser/v1/auth/2fa/authenticate",
          "POST",
          { code: "bad" },
          `${second}; csrftoken=test`,
        ),
      ),
    ).rejects.toThrow("Too many attempts"),
  );
  s.close();
});
