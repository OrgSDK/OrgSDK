import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { openStore } from "./db";
import { plugins, credentials } from "./db/domain";
import { createContext } from "./context";
import { handleAuth } from "./auth";
import {
  handleOAuth,
  executionSecret,
  assertExecutionSecretCurrent,
} from "./oauth";
import { decrypt } from "./security";

const config = {
  domain: "localhost",
  workspace_name: "Test",
  username: "owner",
  email: "owner@example.com",
  password1: "long strong password",
  password2: "long strong password",
};
function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "csrftoken=test",
) {
  return new Request(`http://localhost:8080${path}`, {
    method,
    headers: {
      cookie,
      "x-csrftoken": "test",
      origin: "http://localhost:8080",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-oauth-"));
  const store = openStore(dir);
  await handleAuth(
    createContext(request("/api/v1/setup/", "POST", config), store),
  );
  const login = createContext(
    request("/api/auth/browser/v1/auth/login", "POST", {
      email: config.email,
      password: config.password1,
    }),
    store,
  );
  await handleAuth(login);
  const cookie = login.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const project = (
    store.sqlite.query("SELECT id FROM domain_projects").get() as { id: string }
  ).id;
  const id = randomUUID(),
    timestamp = new Date().toISOString(),
    digest = "a".repeat(64),
    packageUrl = "https://example.com/plugin.tgz";
  store.db
    .insert(plugins)
    .values({
      id,
      workspaceId: 1,
      projectId: project,
      slug: "test-plugin",
      version: "1",
      description: "test",
      source: "",
      digest,
      enabled: true,
      credentialId: null,
      configuration: {},
      releaseMetadata: {
        slug: "test-plugin",
        version: "1",
        digest,
        package_url: packageUrl,
        auth: { type: "oauth2", provider: "google-oauth", scopes: ["email"] },
      },
      packageUrl,
      distribution: "external",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return {
    store,
    cookie,
    id,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function fakeFetch(
  fn: (address: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((address: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fn(String(address), init ?? {}))) as typeof fetch;
}
test("OAuth binds session and user, consumes state once, exchanges securely and refreshes only on server", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
  const f = await fixture();
  try {
    const start = createContext(
      request(
        "/api/v1/credentials/oauth-connect/",
        "POST",
        {
          plugin: f.id,
          name: "Google",
          client_id: "client-id",
          client_secret: "client-secret",
        },
        `${f.cookie}; csrftoken=test`,
      ),
      f.store,
    );
    const begin = await handleOAuth(start);
    expect(begin?.status).toBe(200);
    const url = new URL((await begin!.json()).authorization_url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8080/api/v1/credentials/oauth-callback/",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;
    const row = f.store.sqlite.query("SELECT * FROM oauth_attempts").get() as {
      state_digest: string;
      encrypted_payload: string;
    };
    expect(row.state_digest).not.toBe(state);
    expect(row.encrypted_payload).not.toContain("client-secret");
    const callback = `/api/v1/credentials/oauth-callback/?state=${encodeURIComponent(state)}&code=test-code`;
    await expect(
      handleOAuth(createContext(request(callback), f.store)),
    ).rejects.toThrow();
    let verifier = "";
    const fetcher = fakeFetch((address, init) => {
      expect(address).toBe("https://oauth2.googleapis.com/token");
      expect(init.redirect).toBe("error");
      const body = new URLSearchParams(String(init.body));
      expect(body.get("client_secret")).toBe("client-secret");
      verifier = body.get("code_verifier")!;
      return Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 0,
        scope: "email",
      });
    });
    const result = await handleOAuth(
      createContext(
        request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
        f.store,
      ),
      fetcher,
    );
    expect(result?.status).toBe(302);
    expect(result?.headers.get("location")).toBe("/plugins/");
    expect(url.searchParams.get("code_challenge")).toBe(
      new Bun.CryptoHasher("sha256").update(verifier).digest("base64url"),
    );
    await expect(
      handleOAuth(
        createContext(
          request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
          f.store,
        ),
        fetcher,
      ),
    ).rejects.toThrow("expired");
    const credential = f.store.db.select().from(credentials).get()!;
    const encrypted = decrypt(f.store, credential.encryptedSecret);
    expect(encrypted).toContain("refresh");
    let refreshed = 0;
    const secret = await executionSecret(
      f.store,
      credential,
      fakeFetch((address, init) => {
        refreshed++;
        expect(address).toBe("https://oauth2.googleapis.com/token");
        expect(
          new URLSearchParams(String(init.body)).get("refresh_token"),
        ).toBe("refresh");
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        });
      }),
    );
    expect(secret).toEqual({ secret_accessToken: "new-access", source: "byo" });
    expect(refreshed).toBe(1);
    expect(() =>
      assertExecutionSecretCurrent(f.store, credential, secret),
    ).not.toThrow();
    f.store.db
      .update(credentials)
      .set({ encryptedSecret: credential.encryptedSecret })
      .where(eq(credentials.id, credential.id))
      .run();
    expect(() =>
      assertExecutionSecretCurrent(f.store, credential, secret),
    ).toThrow("Credential changed");
    expect(
      f.store.db.select().from(plugins).where(eq(plugins.id, f.id)).get()
        ?.credentialId,
    ).toBe(credential.id);
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
test("OAuth rejects unsafe origin, mismatched session and changed membership during exchange", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  const f = await fixture();
  try {
    const start = () =>
      createContext(
        request(
          "/api/v1/credentials/oauth-connect/",
          "POST",
          {
            plugin: f.id,
            name: "Google",
            client_id: "client-id",
            client_secret: "client-secret",
          },
          `${f.cookie}; csrftoken=test`,
        ),
        f.store,
      );
    process.env.ORGSDK_PUBLIC_ORIGIN = "https://attacker.example";
    await expect(handleOAuth(start())).rejects.toThrow("must match");
    process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
    const begin = await handleOAuth(start());
    const url = new URL((await begin!.json()).authorization_url);
    const state = url.searchParams.get("state");
    const callback = `/api/v1/credentials/oauth-callback/?state=${state}&code=test`;
    const ctx = createContext(
      request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
      f.store,
    );
    const response = handleOAuth(
      ctx,
      fakeFetch(() => {
        f.store.sqlite.query("DELETE FROM memberships WHERE user_id=1").run();
        return Response.json({ access_token: "token", expires_in: 3600 });
      }),
    );
    await expect(response).rejects.toThrow("workspace access changed");
    expect(f.store.db.select().from(credentials).all()).toHaveLength(0);
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
test("OAuth reports generic provider errors and burns the one-time state", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
  const f = await fixture();
  try {
    const start = createContext(
      request(
        "/api/v1/credentials/oauth-connect/",
        "POST",
        {
          plugin: f.id,
          name: "Google",
          client_id: "client-id",
          client_secret: "client-secret",
        },
        `${f.cookie}; csrftoken=test`,
      ),
      f.store,
    );
    const url = new URL(
      (await (await handleOAuth(start))!.json()).authorization_url,
    );
    const callback = `/api/v1/credentials/oauth-callback/?state=${url.searchParams.get("state")}&code=bad`;
    const ctx = () =>
      createContext(
        request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
        f.store,
      );
    await expect(
      handleOAuth(
        ctx(),
        fakeFetch(
          () => new Response("provider exposed secret", { status: 500 }),
        ),
      ),
    ).rejects.toThrow("OAuth token exchange failed");
    await expect(handleOAuth(ctx())).rejects.toThrow("expired");
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
test("store initializes an encryption key and refuses replacement when protected data exists", async () => {
  const { existsSync, unlinkSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-key-"));
  const path = join(dir, "encryption.key");
  try {
    const store = openStore(dir);
    expect(existsSync(path)).toBe(true);
    store.sqlite
      .query(
        "INSERT INTO users (username,email,password_hash,totp_secret) VALUES ('owner','owner@example.com','hash','protected')",
      )
      .run();
    store.close();
    unlinkSync(path);
    expect(() => openStore(dir)).toThrow("Encryption key is missing");
    expect(existsSync(path)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("version 3 databases migrate to OAuth format without losing records", () => {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-migration-"));
  try {
    const store = openStore(dir);
    store.sqlite.exec(
      "INSERT INTO users (username,email,password_hash) VALUES ('owner','owner@example.com','hash'); DROP TABLE oauth_attempts; UPDATE orgsdk_format SET version=3;",
    );
    store.close();
    const upgraded = openStore(dir);
    expect(
      upgraded.sqlite.query("SELECT version FROM orgsdk_format").get(),
    ).toEqual({ version: 4 });
    expect(upgraded.sqlite.query("SELECT username FROM users").get()).toEqual({
      username: "owner",
    });
    expect(
      upgraded.sqlite
        .query("SELECT name FROM sqlite_master WHERE name='oauth_attempts'")
        .get(),
    ).not.toBeNull();
    upgraded.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP connection route is wired and rejects an untrusted provider", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost:8080";
  const f = await fixture();
  try {
    const { createApp } = await import("./app");
    const app = createApp(f.store);
    const makeRequest = () =>
      request(
        "/api/v1/credentials/oauth-connect/",
        "POST",
        {
          plugin: f.id,
          name: "Google",
          client_id: "client-id",
          client_secret: "client-secret",
        },
        `${f.cookie}; csrftoken=test`,
      );
    const response = await app(makeRequest());
    expect(response.status).toBe(200);
    expect(new URL((await response.json()).authorization_url).hostname).toBe(
      "accounts.google.com",
    );
    const plugin = f.store.db
      .select()
      .from(plugins)
      .where(eq(plugins.id, f.id))
      .get()!;
    f.store.db
      .update(plugins)
      .set({
        releaseMetadata: {
          ...plugin.releaseMetadata,
          auth: {
            type: "oauth2",
            provider: "https://internal.example/token",
            scopes: ["email"],
          },
        },
      })
      .where(eq(plugins.id, f.id))
      .run();
    expect((await app(makeRequest())).status).toBe(400);
  } finally {
    f.close();
    if (before === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = before;
  }
});
