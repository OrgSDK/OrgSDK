import { expect, test } from "bun:test";
import { client, loginOwner, setup, store } from "./core-fixture";
test("revoking an invitation prevents unsent mail from being delivered", async () => {
  const savedHost = process.env.SMTP_HOST;
  const savedFrom = process.env.SMTP_FROM;
  process.env.SMTP_HOST = "test.invalid";
  process.env.SMTP_FROM = "noreply@example.com";
  try {
    const s = store();
    await client(s).auth.setup(setup);
    const { cookie } = await loginOwner(s);
    const invitation = await client(s, cookie).workspace.invite({
      email: "invite@example.com",
      role: "member",
    });
    expect(
      await client(s, cookie).workspace.revokeInvitation({ id: invitation.id }),
    ).toEqual({ revoked: true });
    const { flushOutbox } = await import("../mail/outbox");
    let delivered = false;
    expect(
      await flushOutbox(s, async () => {
        delivered = true;
      }),
    ).toBe(0);
    expect(delivered).toBe(false);
    s.close();
  } finally {
    if (savedHost === undefined) {
      delete process.env.SMTP_HOST;
    } else {
      process.env.SMTP_HOST = savedHost;
    }
    if (savedFrom === undefined) {
      delete process.env.SMTP_FROM;
    } else {
      process.env.SMTP_FROM = savedFrom;
    }
  }
});
