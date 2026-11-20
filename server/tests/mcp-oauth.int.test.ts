import { expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { credentials, plugins } from "../db/schema";
import { finishMcpOAuth } from "../mcp/oauth-callback";
import { mcpExecutionSecret } from "../mcp/oauth-refresh";
import { oauthStateSchema } from "../mcp/oauth-state";
import { oauthFetch } from "../mcp/oauth-network";
import { checkOAuthDestination } from "../mcp/oauth-destination";
import { rpcFixture } from "./rpc-fixture";
import { mcpOAuthFixture } from "./mcp-oauth-fixture";

let previousOrigin: string | undefined;
beforeEach(() => {
  previousOrigin = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost";
});
afterEach(() => {
  if (previousOrigin === undefined) {
    delete process.env.ORGSDK_PUBLIC_ORIGIN;
  } else {
    process.env.ORGSDK_PUBLIC_ORIGIN = previousOrigin;
  }
});

for (const registered of [false, true]) {
  test(`MCP OAuth ${registered ? "pre-registered" : "dynamic"} registration, PKCE, callback, scoped access and refresh`, async () => {
    const fixture = rpcFixture();
    const server = mcpOAuthFixture();
    try {
      const caller = fixture.caller();
      const connection = await caller.plugins.mcp.create({
        project: fixture.project.id,
        slug: "oauth-tools",
        endpoint: server.endpoint,
        auth_mode: "oauth",
      });
      const started = await caller.plugins.mcp.beginOAuth({
        id: connection.id,
        ...(registered
          ? {
              client_id: "manual-client",
              client_secret: "client-secret-synthetic",
            }
          : {}),
      });
      const url = new URL(started.authorization_url);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("resource")).toBe(server.endpoint);
      expect(url.searchParams.get("client_id")).toBe(
        registered ? "manual-client" : "registered-client",
      );
      await fetch(url);
      const state = url.searchParams.get("state");
      if (!state) {
        throw new Error("Missing state");
      }
      const callback = new URLSearchParams({
        state,
        code: "test-code",
        iss: server.origin,
      });
      const response = await fixture.request(
        `/oauth/mcp/callback?${callback.toString()}`,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `/plugins/?project=${fixture.project.id}`,
      );
      const plugin = fixture.store.db
        .select()
        .from(plugins)
        .where(eq(plugins.id, connection.id))
        .get();
      if (!plugin?.credentialId) {
        throw new Error("Credential was not connected");
      }
      const credential = fixture.store.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, plugin.credentialId))
        .get();
      if (!credential) {
        throw new Error("Missing credential");
      }
      expect(credential.encryptedSecret).not.toContain(
        "refresh-synthetic-secret",
      );
      const access = await mcpExecutionSecret(fixture.context(), credential);
      expect(access).toMatchObject({
        headers: { Authorization: "Bearer access-1-synthetic" },
      });
      expect(JSON.stringify(access)).not.toContain("refresh-synthetic");
      const publicView = await caller.plugins.mcp.get(connection);
      expect(publicView.authenticated).toBe(true);
      expect(JSON.stringify(publicView)).not.toContain("access-1-synthetic");
      await Promise.resolve(
        expect(
          caller.credentials.update({ id: credential.id, provider: "plain" }),
        ).rejects.toThrow("project plugins"),
      );
      const stored = oauthStateSchema.parse(
        JSON.parse(fixture.store.secrets.decrypt(credential.encryptedSecret)),
      );
      stored.expiresAt = 0;
      fixture.store.db
        .update(credentials)
        .set({
          encryptedSecret: fixture.store.secrets.encrypt(
            JSON.stringify(stored),
          ),
        })
        .where(eq(credentials.id, credential.id))
        .run();
      const [first, second] = await Promise.all([
        mcpExecutionSecret(fixture.context(), credential),
        mcpExecutionSecret(fixture.context(), credential),
      ]);
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        headers: { Authorization: "Bearer access-2-synthetic" },
      });
      expect(server.exchanges).toHaveLength(2);
      expect(server.exchanges[1]?.get("grant_type")).toBe("refresh_token");
      await Promise.resolve(
        expect(
          finishMcpOAuth(fixture.context(), {
            state,
            code: "replay",
            iss: server.origin,
          }),
        ).rejects.toThrow("expired"),
      );
    } finally {
      await server.close();
      fixture.close();
    }
  }, 15000);
}

test("OAuth rejects wrong state, browser session, issuer, changed endpoint and unsafe destinations", async () => {
  const fixture = rpcFixture();
  const server = mcpOAuthFixture();
  try {
    const caller = fixture.caller();
    const connection = await caller.plugins.mcp.create({
      project: fixture.project.id,
      slug: "oauth-tools",
      endpoint: server.endpoint,
      auth_mode: "oauth",
    });
    async function start() {
      const result = await caller.plugins.mcp.beginOAuth({
        id: connection.id,
        client_id: "manual",
      });
      const url = new URL(result.authorization_url);
      await fetch(url);
      const state = url.searchParams.get("state");
      if (!state) {
        throw new Error("Missing state");
      }
      return state;
    }
    await Promise.resolve(
      expect(
        finishMcpOAuth(fixture.context(), { state: "wrong", code: "test" }),
      ).rejects.toThrow(),
    );
    const state = await start();
    await Promise.resolve(
      expect(
        finishMcpOAuth(
          { ...fixture.context(), sessionId: "wrong-session" },
          { state, code: "test" },
        ),
      ).rejects.toThrow(),
    );
    await Promise.resolve(
      expect(
        finishMcpOAuth(fixture.context(), {
          state,
          code: "test",
          iss: "https://wrong.example",
        }),
      ).rejects.toThrow(),
    );
    const changed = await start();
    await caller.plugins.mcp.update({
      id: connection.id,
      endpoint: `${server.origin}/replacement`,
    });
    await Promise.resolve(
      expect(
        finishMcpOAuth(fixture.context(), {
          state: changed,
          code: "test",
          iss: server.origin,
        }),
      ).rejects.toThrow("changed"),
    );
    expect(server.exchanges).toHaveLength(0);
    await Promise.resolve(
      expect(
        checkOAuthDestination(
          "https://[::ffff:a9fe:a9fe]/token",
          "https://public.example/mcp",
        ),
      ).rejects.toThrow("private"),
    );
    await Promise.resolve(
      expect(
        checkOAuthDestination(
          "https://169.254.169.254/token",
          "https://public.example/mcp",
        ),
      ).rejects.toThrow("private"),
    );
    await Promise.resolve(
      expect(
        checkOAuthDestination(
          "http://127.0.0.1/token",
          "https://public.example/mcp",
        ),
      ).rejects.toThrow("HTTPS"),
    );
  } finally {
    await server.close();
    fixture.close();
  }
});

test("OAuth fetch rejects redirects without forwarding client credentials", async () => {
  let received = false;
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      received = true;
      return Response.json({});
    },
  });
  const source = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.redirect(`http://127.0.0.1:${sink.port}`, 307);
    },
  });
  try {
    const endpoint = `http://127.0.0.1:${source.port}`;
    await Promise.resolve(
      expect(
        oauthFetch(endpoint)(endpoint, {
          method: "POST",
          body: "client_secret=synthetic",
        }),
      ).rejects.toThrow(),
    );
    expect(received).toBe(false);
  } finally {
    await source.stop(true);
    await sink.stop(true);
  }
});
