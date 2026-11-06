import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { credentials, plugins } from "../db/schema";
import { createContext } from "../http/context";
import { executionSecret } from "../oauth/refresh";
import { tokenExchange } from "../oauth/tokens";
import { handleOAuthCallback } from "../oauth/transport";
import { decrypt } from "../shared/security";
import { fakeFetch, fixture, request } from "./oauth-fixture";

test("Xero confidential web OAuth connects, rotates tokens and injects only access credentials", async () => {
  const previousOrigin = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost";
  const scopes = [
    "offline_access",
    "accounting.invoices.read",
    "accounting.contacts.read",
    "accounting.attachments.read",
  ];
  const context = fixture({ provider: "xero-oauth", scopes });
  try {
    const begin = await context.caller().credentials.beginOAuth({
      plugin: context.id,
      name: "Xero invoices",
      client_id: "xero-client",
      client_secret: "xero-secret",
    });
    const authorization = new URL(begin.authorization_url);
    expect(`${authorization.origin}${authorization.pathname}`).toBe(
      "https://login.xero.com/identity/connect/authorize",
    );
    expect(authorization.searchParams.get("scope")).toBe(scopes.join(" "));
    expect(authorization.searchParams.get("code_challenge")).toBeNull();
    expect(authorization.searchParams.get("client_secret")).toBeNull();
    const state = authorization.searchParams.get("state");
    expect(state).toBeTruthy();
    let calls = 0;
    const fetcher = fakeFetch((address, init) => {
      calls++;
      expect(address).toBe("https://identity.xero.com/connect/token");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("authorization")).toBe(
        `Basic ${Buffer.from("xero-client:xero-secret").toString("base64")}`,
      );
      const body = new URLSearchParams(String(init.body));
      expect(body.has("client_secret")).toBe(false);
      if (calls === 1) {
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("xero-code");
        expect(body.get("redirect_uri")).toBe(
          "http://localhost/oauth/callback",
        );
        expect(body.has("code_verifier")).toBe(false);
      } else {
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("xero-refresh-1");
      }
      return Response.json({
        access_token: `xero-access-${calls}`,
        refresh_token: `xero-refresh-${calls}`,
        expires_in: calls === 1 ? 0 : 1800,
        scope: scopes.join(" "),
      });
    });
    const callback = `/oauth/callback?state=${encodeURIComponent(state ?? "")}&code=xero-code`;
    const response = await handleOAuthCallback(
      createContext(
        request(
          callback,
          "GET",
          undefined,
          `${context.cookie}; csrftoken=test`,
        ),
        context.store,
      ),
      fetcher,
    );
    expect(response.status).toBe(302);
    const credential = context.store.db.select().from(credentials).get();
    if (!credential) {
      throw new Error("OAuth did not create a credential");
    }
    expect(credential.provider).toBe("xero-oauth");
    expect(credential.encryptedSecret).not.toContain("xero-secret");
    const secret = await executionSecret(context.store, credential, fetcher);
    expect(secret).toEqual({
      secret_accessToken: "xero-access-2",
      source: "byo",
    });
    expect(calls).toBe(2);
    const saved = context.store.db.select().from(credentials).get();
    if (!saved) {
      throw new Error("OAuth credential disappeared");
    }
    expect(decrypt(context.store, saved.encryptedSecret)).toContain(
      "xero-refresh-2",
    );
    expect(decrypt(context.store, saved.encryptedSecret)).not.toContain(
      "xero-refresh-1",
    );
    expect(await executionSecret(context.store, saved, fetcher)).toEqual(
      secret,
    );
    expect(calls).toBe(2);
    expect(
      context.store.db
        .select()
        .from(plugins)
        .where(eq(plugins.id, context.id))
        .get()?.credentialId,
    ).toBe(credential.id);
  } finally {
    context.close();
    if (previousOrigin === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = previousOrigin;
    }
  }
});

test("Xero token failures never expose provider response bodies or client secrets", async () => {
  await Promise.resolve(
    expect(
      tokenExchange(
        "xero-oauth",
        "xero-client",
        "xero-secret",
        { grant_type: "refresh_token", refresh_token: "private-refresh" },
        fakeFetch(
          () => new Response("xero-secret private-refresh", { status: 401 }),
        ),
      ),
    ).rejects.toThrow(
      "OAuth token exchange failed. Check the app settings and reconnect.",
    ),
  );
});
