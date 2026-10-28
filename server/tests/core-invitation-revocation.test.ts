import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("revoking an invitation prevents unsent mail from being delivered", async () => {
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
    const cookie = `${session}; csrftoken=test`;
    const invitation = await call(
      s,
      req(
        "/api/v1/workspaces/invitations/",
        "POST",
        { email: "invite@example.com", role: "member" },
        cookie,
      ),
    );
    const { id } = await invitation.response.json();
    expect(invitation.response.status).toBe(201);
    expect(
      (
        await call(
          s,
          req(
            `/api/v1/workspaces/invitations/${id}/`,
            "DELETE",
            undefined,
            cookie,
          ),
        )
      ).response.status,
    ).toBe(204);
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
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
    if (savedFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = savedFrom;
  }
});
