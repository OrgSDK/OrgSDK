import { expect, test } from "bun:test";
import { createContext, requireWorkspace } from "../http/context";
import { call, req, setup, store } from "./core-fixture";
test("invitations queue encrypted mail, retry and admit only matching account", async () => {
  const savedHost = process.env.SMTP_HOST,
    savedFrom = process.env.SMTP_FROM;
  process.env.SMTP_HOST = "test.invalid";
  process.env.SMTP_FROM = "noreply@example.com";
  try {
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
    const created = await call(
      s,
      req(
        "/api/v1/workspaces/invitations/",
        "POST",
        { email: "member@example.com", role: "member" },
        `${session}; csrftoken=test`,
      ),
    );
    expect(created.response.status).toBe(201);
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
    const signup = await call(
      s,
      req("/api/auth/browser/v1/auth/signup", "POST", {
        email: "member@example.com",
        username: "member",
        password: "strong password here",
      }),
    );
    const memberSession = signup.ctx.responseHeaders
      .getSetCookie()
      .find((x) => x.startsWith("sessionid="))!
      .split(";")[0]!;
    const accepted = await call(
      s,
      req(
        `/api/v1/workspaces/invitations/${token}/accept/`,
        "POST",
        {},
        `${memberSession}; csrftoken=test`,
      ),
    );
    expect(accepted.response.status).toBe(200);
    const member = createContext(
      req("/api/v1/workspaces/current/", "GET", undefined, memberSession),
      s,
    );
    expect(requireWorkspace(member).name).toBe("Test");
    await Promise.resolve(
      expect(
        call(
          s,
          req(
            "/api/v1/workspaces/members/1/",
            "DELETE",
            undefined,
            `${memberSession}; csrftoken=test`,
          ),
        ),
      ).rejects.toThrow(),
    );
    s.close();
  } finally {
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
    if (savedFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = savedFrom;
  }
});
