import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { credentials, plugins } from "../db/schema";
import { createContext } from "../http/context";
import {
  assertExecutionSecretCurrent,
  executionSecret,
} from "../oauth/refresh";
import { handleOAuthCallback } from "../oauth/transport";
import { decrypt } from "../shared/security";
import { fakeFetch, fixture, request } from "./oauth-fixture";
test("OAuth binds session and user, consumes state once, exchanges securely and refreshes only on server", async () => {
  const before = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "http://localhost";
  const f = fixture();
  try {
    const begin = await f.caller().credentials.beginOAuth({
      plugin: f.id,
      name: "Google",
      client_id: "client-id",
      client_secret: "client-secret",
    });
    const url = new URL(begin.authorization_url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/oauth/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;
    const row = f.store.sqlite.query("SELECT * FROM oauth_attempts").get() as {
      state_digest: string;
      encrypted_payload: string;
    };
    expect(row.state_digest).not.toBe(state);
    expect(row.encrypted_payload).not.toContain("client-secret");
    const callback = `/oauth/callback?state=${encodeURIComponent(state)}&code=test-code`;
    await Promise.resolve(
      expect(
        handleOAuthCallback(createContext(request(callback), f.store)),
      ).rejects.toThrow(),
    );
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
    const result = await handleOAuthCallback(
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
    await Promise.resolve(
      expect(
        handleOAuthCallback(
          createContext(
            request(callback, "GET", undefined, `${f.cookie}; csrftoken=test`),
            f.store,
          ),
          fetcher,
        ),
      ).rejects.toThrow("expired"),
    );
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
    if (before === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = before;
    }
  }
});
