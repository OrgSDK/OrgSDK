import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { encrypt } from "../shared/security";
import { client, sessionCookie, setup, store } from "./core-fixture";
test("TOTP codes cannot be replayed across login challenges and failures are throttled", async () => {
  const s = store();
  await client(s).auth.setup(setup);
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
    const caller = client(s);
    expect(
      (
        await caller.auth.login({
          email: setup.email,
          password: setup.password1,
        })
      ).is_authenticated,
    ).toBe(false);
    return `${sessionCookie(caller.ctx)}; csrftoken=test`;
  }
  const first = await challenge();
  const second = await challenge();
  expect(
    (await client(s, first).auth.mfaAuthenticate({ code })).is_authenticated,
  ).toBe(true);
  await Promise.resolve(
    expect(client(s, second).auth.mfaAuthenticate({ code })).rejects.toThrow(
      "Invalid authentication code",
    ),
  );
  for (let index = 0; index < 8; index++) {
    await Promise.resolve(
      expect(
        client(s, second).auth.mfaAuthenticate({ code: "bad" }),
      ).rejects.toThrow("Invalid authentication code"),
    );
  }
  await Promise.resolve(
    expect(
      client(s, second).auth.mfaAuthenticate({ code: "bad" }),
    ).rejects.toThrow("Too many attempts"),
  );
  s.close();
});
