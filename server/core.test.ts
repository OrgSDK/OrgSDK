import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./db";
import { createContext, checkCsrf, requireWorkspace } from "./context";
import { handleAuth } from "./auth";
import { HttpError } from "./http";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  return openStore(dir);
}
function req(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "csrftoken=test",
  host = "localhost",
) {
  return new Request(`http://${host}${path}`, {
    method,
    headers: {
      cookie,
      ...(method === "GET"
        ? {}
        : {
            "x-csrftoken": "test",
            origin: `http://${host}`,
            "content-type": "application/json",
          }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function call(s: ReturnType<typeof store>, request: Request) {
  const ctx = createContext(request, s);
  checkCsrf(ctx);
  const response = await handleAuth(ctx);
  return { ctx, response: response! };
}
const setup = {
  domain: "localhost",
  workspace_name: "Test",
  username: "owner",
  email: "owner@example.com",
  password1: "very strong password",
  password2: "very strong password",
  project_name: "First",
};
test("setup is atomic and login rotates session; foreign hosts cannot access it", async () => {
  const s = store();
  expect(
    (await call(s, req("/api/v1/setup/", "POST", setup))).response.status,
  ).toBe(201);
  expect(
    s.sqlite.query("select count(*) as count from domain_projects").get(),
  ).toEqual({ count: 1 });
  await expect(call(s, req("/api/v1/setup/", "POST", setup))).rejects.toThrow(
    "already complete",
  );
  const login = await call(
    s,
    req("/api/auth/browser/v1/auth/login", "POST", {
      email: setup.email,
      password: setup.password1,
    }),
  );
  expect(login.response.status).toBe(200);
  const cookies = login.ctx.responseHeaders.getSetCookie();
  const session = cookies
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const foreign = createContext(
    req(
      "/api/v1/workspaces/current/",
      "GET",
      undefined,
      session,
      "other.local",
    ),
    s,
  );
  expect(() => requireWorkspace(foreign)).toThrow();
  const me = await call(s, req("/api/v1/session/", "GET", undefined, session));
  expect((await me.response.json()).is_authenticated).toBe(true);
  s.close();
});
test("unsafe requests require matching token and same origin", () => {
  const s = store();
  const ctx = createContext(
    new Request("http://localhost/api/v1/setup/", {
      method: "POST",
      headers: {
        cookie: "csrftoken=a",
        "x-csrftoken": "a",
        origin: "http://evil.example",
      },
    }),
    s,
  );
  expect(() => checkCsrf(ctx)).toThrow(HttpError);
  expect(() =>
    checkCsrf(
      createContext(
        new Request("http://localhost/api/v1/setup/", { method: "POST" }),
        s,
      ),
    ),
  ).toThrow(HttpError);
  s.close();
});
test("existing SQLite data is never opened as a new installation", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  writeFileSync(join(dir, "db.sqlite3"), "existing data");
  expect(() => openStore(dir)).toThrow("Existing SQLite database");
});
test("password login throttles repeated attempts", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  for (let i = 0; i < 10; i++)
    expect(
      (
        await call(
          s,
          req("/api/auth/browser/v1/auth/login", "POST", {
            email: setup.email,
            password: "wrong",
          }),
        )
      ).response.status,
    ).toBe(400);
  await expect(
    call(
      s,
      req("/api/auth/browser/v1/auth/login", "POST", {
        email: setup.email,
        password: "wrong",
      }),
    ),
  ).rejects.toThrow("Too many attempts");
  s.close();
});
test("recovery codes are single use and MFA sessions are challenged", async () => {
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
  const { encrypt, digest } = await import("./security");
  const code = "one-time-code";
  s.sqlite
    .query("UPDATE users SET totp_secret=?, recovery_codes=? WHERE id=1")
    .run(encrypt(s, "JBSWY3DPEHPK3PXP"), JSON.stringify([digest(code)]));
  const challenge = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/login",
      "POST",
      { email: setup.email, password: setup.password1 },
      cookie,
    ),
  );
  expect(challenge.response.status).toBe(401);
  const pending = challenge.ctx.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const verify = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/2fa/authenticate",
      "POST",
      { code },
      `${pending}; csrftoken=test`,
    ),
  );
  expect(verify.response.status).toBe(200);
  const challenge2 = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/login",
      "POST",
      { email: setup.email, password: setup.password1 },
      cookie,
    ),
  );
  const pending2 = challenge2.ctx.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  expect(
    (
      await call(
        s,
        req(
          "/api/auth/browser/v1/auth/2fa/authenticate",
          "POST",
          { code },
          `${pending2}; csrftoken=test`,
        ),
      )
    ).response.status,
  ).toBe(400);
  s.close();
});
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
    const { flushOutbox } = await import("./mail");
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
    await expect(
      call(
        s,
        req(
          "/api/v1/workspaces/members/1/",
          "DELETE",
          undefined,
          `${memberSession}; csrftoken=test`,
        ),
      ),
    ).rejects.toThrow();
    s.close();
  } finally {
    if (savedHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedHost;
    if (savedFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = savedFrom;
  }
});
test("account changes require fresh identity and logout revokes the session", async () => {
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
  s.sqlite.query("UPDATE sessions SET reauthenticated_at=0").run();
  await expect(
    call(
      s,
      req(
        "/api/auth/browser/v1/account/email",
        "POST",
        { email: "new@example.com" },
        cookie,
      ),
    ),
  ).rejects.toThrow("Confirm your identity");
  const confirmed = await call(
    s,
    req(
      "/api/auth/browser/v1/auth/reauthenticate",
      "POST",
      { password: setup.password1 },
      cookie,
    ),
  );
  expect(confirmed.response.status).toBe(200);
  const changed = await call(
    s,
    req(
      "/api/auth/browser/v1/account/email",
      "POST",
      { email: "new@example.com" },
      cookie,
    ),
  );
  expect(changed.response.status).toBe(200);
  const logout = await call(
    s,
    req("/api/auth/browser/v1/auth/session", "DELETE", undefined, cookie),
  );
  expect(logout.response.status).toBe(401);
  const current = await call(
    s,
    req("/api/v1/session/", "GET", undefined, session),
  );
  expect((await current.response.json()).is_authenticated).toBe(false);
  s.close();
});
test("a Django database at the expected filename is refused without modification", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-core-"));
  dirs.push(dir);
  const path = join(dir, "orgsdk-bun.sqlite3");
  const db = new (require("bun:sqlite").Database)(path);
  db.exec("CREATE TABLE django_migrations (id INTEGER PRIMARY KEY);");
  db.close();
  const before = require("node:fs").readFileSync(path);
  expect(() => openStore(dir)).toThrow("refusing to open");
  expect(require("node:fs").readFileSync(path)).toEqual(before);
});
test("TOTP codes cannot be replayed across login challenges and failures are throttled", async () => {
  const s = store();
  await call(s, req("/api/v1/setup/", "POST", setup));
  const { encrypt } = await import("./security");
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
  await expect(
    call(
      s,
      req(
        "/api/auth/browser/v1/auth/2fa/authenticate",
        "POST",
        { code: "bad" },
        `${second}; csrftoken=test`,
      ),
    ),
  ).rejects.toThrow("Too many attempts");
  s.close();
});
test("a bearer token cannot use an existing browser session to manage members", async () => {
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
  const { accessTokens } = await import("./db/domain");
  const { digest } = await import("./security");
  const at = new Date().toISOString();
  s.db
    .insert(accessTokens)
    .values({
      id: "token",
      workspaceId: 1,
      actorId: 1,
      name: "test",
      digest: digest("bearer-secret"),
      scopes: ["write"],
      projects: [],
      actionVersions: [],
      revoked: false,
      firstUsedAt: null,
      lastUsedAt: null,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      restRequestCount: 0,
      mcpRequestCount: 0,
      lastTransport: "",
      lastOutcome: "",
      lastStatusCode: null,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const request = req(
    "/api/v1/workspaces/current/",
    "PATCH",
    { name: "Changed" },
    `${session}; csrftoken=test`,
  );
  request.headers.set("authorization", "Bearer bearer-secret");
  const ctx = createContext(request, s);
  expect(ctx.token).not.toBeNull();
  checkCsrf(ctx);
  await expect(handleAuth(ctx)).rejects.toThrow("requires a browser session");
  expect(s.sqlite.query("SELECT name FROM workspaces").get()).toEqual({
    name: "Test",
  });
  s.close();
});
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
    const { flushOutbox } = await import("./mail");
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
test("session bootstrap directs a fresh install to setup", async () => {
  const s = store();
  const bootstrap = await call(s, req("/api/v1/session/"));
  expect(bootstrap.response.status).toBe(503);
  expect((await bootstrap.response.json()).code).toBe("setup_required");
  await call(s, req("/api/v1/setup/", "POST", setup));
  expect((await call(s, req("/api/v1/session/"))).response.status).toBe(200);
  s.close();
});
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
    await expect(login).rejects.toThrow("account changed");
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
test("pending MFA sessions are revoked when the password changes", async () => {
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
  s.sqlite
    .query(
      "INSERT INTO sessions (id,pending_user_id,expires_at) VALUES ('pending',1,?)",
    )
    .run(Date.now() + 300000);
  const result = await call(
    s,
    req(
      "/api/auth/browser/v1/account/password/change",
      "POST",
      {
        current_password: setup.password1,
        new_password: "different strong password",
      },
      cookie,
    ),
  );
  expect(result.response.status).toBe(200);
  expect(
    s.sqlite.query("SELECT id FROM sessions WHERE id='pending'").get(),
  ).toBeNull();
  s.close();
});
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
    await expect(confirmation).rejects.toThrow("session has expired");
    expect(
      s.sqlite.query("SELECT count(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });
  } finally {
    Bun.password.verify = original;
    s.close();
  }
});
