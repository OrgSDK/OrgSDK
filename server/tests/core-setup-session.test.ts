import { expect, test } from "bun:test";
import { createContext, requireWorkspace } from "../http/context";
import { call, req, setup, store } from "./core-fixture";
test("setup is atomic and login rotates session; foreign hosts cannot access it", async () => {
  const s = store();
  expect(
    (await call(s, req("/api/v1/setup/", "POST", setup))).response.status,
  ).toBe(201);
  expect(
    s.sqlite.query("select count(*) as count from projects").get(),
  ).toEqual({ count: 1 });
  await Promise.resolve(
    expect(call(s, req("/api/v1/setup/", "POST", setup))).rejects.toThrow(
      "already complete",
    ),
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
