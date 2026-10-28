import { expect, test } from "bun:test";
import { client, loginOwner, setup, store } from "./core-fixture";
test("a bearer token cannot use an existing browser session to manage members", async () => {
  const s = store();
  await client(s).auth.setup(setup);
  const { cookie } = await loginOwner(s);
  const { accessTokens } = await import("../db/schema");
  const { digest } = await import("../shared/security");
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
      trpcRequestCount: 0,
      mcpRequestCount: 0,
      lastTransport: "",
      lastOutcome: "",
      lastStatusCode: null,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const caller = client(s, cookie, "localhost", {
    authorization: "Bearer bearer-secret",
  });
  expect(caller.ctx.token).not.toBeNull();
  await Promise.resolve(
    expect(caller.workspace.update({ name: "Changed" })).rejects.toThrow(
      "requires a browser session",
    ),
  );
  expect(s.sqlite.query("SELECT name FROM workspaces").get()).toEqual({
    name: "Test",
  });
  s.close();
});
