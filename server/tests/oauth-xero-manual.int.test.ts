import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { openStore } from "../db";
import { credentials, sessions } from "../db/schema";
import { createContext } from "../http/context";
import {
  assertExecutionSecretCurrent,
  executionSecret,
} from "../oauth/refresh";
import { createProcedure } from "../router/credentials/create";
import { router } from "../router/procedures";
import { digest } from "../shared/security";
import { seedWorkspace, temporaryDatabase } from "./database-fixture";

// Exercise the real credential procedure without importing unrelated mail routes.
const credentialRouter = router({ create: createProcedure });
function fixture() {
  const temporary = temporaryDatabase();
  const store = openStore(temporary.directory);
  const seeded = seedWorkspace(store);
  store.db
    .insert(sessions)
    .values({
      id: digest("manual-xero-session"),
      userId: seeded.user.id,
      workspaceId: seeded.workspace.id,
      expiresAt: Date.now() + 300_000,
    })
    .run();
  const request = new Request("http://localhost/trpc", {
    method: "POST",
    headers: {
      cookie: "sessionid=manual-xero-session; csrftoken=test",
      "x-csrftoken": "test",
      origin: "http://localhost",
    },
  });
  const caller = credentialRouter.createCaller(createContext(request, store));
  return {
    store,
    async create(
      secret: Record<string, string | number | null>,
      provider = "xero-oauth",
    ) {
      const created = await caller.create({
        name: "Manual Xero token on host 0.1.0",
        provider,
        secret,
      });
      const credential = store.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, created.id))
        .get();
      if (!credential) {
        throw new Error("Manual credential was not persisted");
      }
      return credential;
    },
    close() {
      store.close();
      temporary.cleanup();
    },
  };
}

const noNetwork: typeof fetch = Object.assign(
  () => {
    throw new Error("Manual credentials must never contact OAuth");
  },
  {
    preconnect: () => {
      throw new Error("Manual credentials must never contact OAuth");
    },
  },
);

test("legacy manual Xero access-token credentials reach execution without refresh", async () => {
  const context = fixture();
  try {
    const credential = await context.create({
      secret_accessToken: "manual-xero-access",
    });
    const secret = await executionSecret(context.store, credential, noNetwork);
    expect(secret).toEqual({ secret_accessToken: "manual-xero-access" });
    expect(() =>
      assertExecutionSecretCurrent(context.store, credential, secret),
    ).not.toThrow();
    expect(credential.encryptedSecret).not.toContain("manual-xero-access");
    context.store.db
      .update(credentials)
      .set({ encryptedSecret: context.store.secrets.encrypt("{}") })
      .where(eq(credentials.id, credential.id))
      .run();
    expect(() =>
      assertExecutionSecretCurrent(context.store, credential, secret),
    ).toThrow("Credential changed");
  } finally {
    context.close();
  }
});

const malformedPayloads: Record<string, string | number | null>[] = [
  { secret_accessToken: "" },
  { secret_accessToken: null },
  { secret_accessToken: "access", source: "byo" },
  { secret_accessToken: "access", source: "first-party" },
  { secret_accessToken: "access", source: null },
  { secret_accessToken: "access", secret_clientId: "private-client" },
  { secret_accessToken: "access", secret_clientSecret: "private-secret" },
  { secret_accessToken: "access", secret_refreshToken: "private-refresh" },
  { secret_accessToken: "access", expires_at: 0 },
  { secret_accessToken: "access", expires_at: "invalid" },
];
for (const [index, payload] of malformedPayloads.entries()) {
  test(`Xero refuses malformed or ambiguous managed payload ${index}`, async () => {
    const context = fixture();
    try {
      const credential = await context.create(payload);
      await Promise.resolve(
        expect(
          executionSecret(context.store, credential, noNetwork),
        ).rejects.toThrow("Reconnect using your own OAuth application."),
      );
    } finally {
      context.close();
    }
  });
}

test("the manual Xero exception does not change Google managed-only resolution", async () => {
  const context = fixture();
  try {
    const credential = await context.create(
      { secret_accessToken: "manual-google-access" },
      "google-oauth",
    );
    await Promise.resolve(
      expect(
        executionSecret(context.store, credential, noNetwork),
      ).rejects.toThrow("Reconnect using your own OAuth application."),
    );
  } finally {
    context.close();
  }
});
