import { expect, test } from "bun:test";
import { requireWorkspace } from "../shared/authorization";
import {
  client,
  loginOwner,
  sessionCookie,
  setup,
  store,
} from "./core-fixture";
test("invitations queue encrypted mail, retry and admit only matching account", async () => {
  const savedHost = process.env.SMTP_HOST;
  const savedFrom = process.env.SMTP_FROM;
  process.env.SMTP_HOST = "test.invalid";
  process.env.SMTP_FROM = "noreply@example.com";
  try {
    const s = store();
    await client(s).auth.setup(setup);
    const { cookie } = await loginOwner(s);
    const created = await client(s, cookie).workspace.invite({
      email: "member@example.com",
      role: "member",
    });
    expect(created.email).toBe("member@example.com");
    const row = s.sqlite.query("SELECT body FROM mail_outbox").get() as {
      body: string;
    };
    expect(row.body).not.toContain("member@example.com");
    const { flushOutbox } = await import("../mail/outbox");
    expect(
      await flushOutbox(s, async () => {
        throw Error("secret SMTP failure");
      }),
    ).toBe(0);
    const failure = s.sqlite
      .query("SELECT attempts,last_error FROM mail_outbox")
      .get();
    expect(failure).toEqual({ attempts: 1, last_error: "Delivery failed" });
    s.sqlite.query("UPDATE mail_outbox SET next_attempt=0").run();
    let message = "";
    expect(
      await flushOutbox(s, async (mail) => {
        message = mail.text;
      }),
    ).toBe(1);
    const token = new URL(message.match(/http:\/\/\S+/)![0]!).searchParams.get(
      "token",
    )!;
    const signup = client(s);
    await signup.auth.signup({
      email: "member@example.com",
      username: "member",
      password: "strong password here",
    });
    const memberCookie = `${sessionCookie(signup.ctx)}; csrftoken=test`;
    expect(
      await client(s, memberCookie).workspace.acceptInvitation({ token }),
    ).toEqual({ id: 1, name: "Test" });
    expect(requireWorkspace(client(s, memberCookie).ctx).name).toBe("Test");
    await Promise.resolve(
      expect(
        client(s, memberCookie).workspace.removeMember({ id: 1 }),
      ).rejects.toThrow(),
    );
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
