import { expect, test } from "bun:test";
import { call, req, setup, store } from "./core-fixture";
test("session bootstrap directs a fresh install to setup", async () => {
  const s = store();
  const bootstrap = await call(s, req("/api/v1/session/"));
  expect(bootstrap.response.status).toBe(503);
  expect((await bootstrap.response.json()).code).toBe("setup_required");
  await call(s, req("/api/v1/setup/", "POST", setup));
  expect((await call(s, req("/api/v1/session/"))).response.status).toBe(200);
  s.close();
});
