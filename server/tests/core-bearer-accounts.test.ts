import { expect, test } from "bun:test";
import { handleAuth } from "../auth/routes";
import { checkCsrf, createContext } from "../http/context";
import { call, req, setup, store } from "./core-fixture";
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
  await Promise.resolve(
    expect(handleAuth(ctx)).rejects.toThrow("requires a browser session"),
  );
  expect(s.sqlite.query("SELECT name FROM workspaces").get()).toEqual({
    name: "Test",
  });
  s.close();
});
