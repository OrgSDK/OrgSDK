import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { decode32 } from "../auth/totp";
import { client, loginOwner, setup, store } from "./core-fixture";

function currentTotp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", decode32(secret)).update(counter).digest();
  const offset = mac[19]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

test("native authenticator enrollment, recovery, and removal keep identity guards", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  expect(await client(s, cookie).auth.authenticators()).toEqual([]);
  const pending = await client(s, cookie).auth.totpSetup();
  expect(pending.enabled).toBe(false);
  if (!pending.secret) {
    throw new Error("Expected a TOTP enrollment secret.");
  }
  const code = currentTotp(pending.secret);
  expect(await client(s, cookie).auth.enableTotp({ code })).toEqual({
    type: "totp",
  });
  expect(await client(s, cookie).auth.authenticators()).toEqual([
    { type: "totp" },
  ]);
  expect(await client(s, cookie).auth.totpSetup()).toEqual({
    enabled: true,
    secret: null,
  });
  await Promise.resolve(
    expect(
      client(s, cookie).auth.reauthenticate({ password: setup.password1 }),
    ).rejects.toThrow("Use your authenticator code"),
  );
  const recovery = await client(s, cookie).auth.generateRecoveryCodes();
  expect(recovery.unused_codes).toHaveLength(10);
  expect(await client(s, cookie).auth.recoveryCodes()).toEqual({
    unused_codes: [],
  });
  expect(
    (
      await client(s, cookie).auth.mfaReauthenticate({
        code: recovery.unused_codes[0]!,
      })
    ).is_authenticated,
  ).toBe(true);
  await Promise.resolve(
    expect(
      client(s, cookie).auth.mfaReauthenticate({
        code: recovery.unused_codes[0]!,
      }),
    ).rejects.toThrow("Invalid authentication code"),
  );
  expect(await client(s, cookie).auth.disableTotp()).toEqual({
    enabled: false,
  });
  expect(await client(s, cookie).auth.authenticators()).toEqual([]);
  await Promise.resolve(
    expect(client(s, cookie).auth.generateRecoveryCodes()).rejects.toThrow(
      "Enable two-factor authentication first",
    ),
  );
  s.close();
});
