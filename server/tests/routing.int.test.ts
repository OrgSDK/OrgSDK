import { expect, test } from "bun:test";
import { z } from "zod";
import { rpcFixture } from "./rpc-fixture";

test("application API is native tRPC and retired REST endpoints are absent", async () => {
  const fixture = rpcFixture();
  try {
    for (const path of [
      "/api/v1/projects/",
      "/api/v1/projects",
      "/api/v1/setup/",
      "/api/trpc/projects.list",
      "/api/auth/browser/v1/auth/login",
      "/api/health/",
      "/trpc-spoof",
    ]) {
      expect((await fixture.request(path)).status).toBe(404);
      expect((await fixture.request(path, "POST", {})).status).toBe(404);
    }
    expect((await fixture.rpc("projects.list")).status).toBe(200);
    expect((await fixture.rpc("unknown.procedure")).status).toBe(404);
    // The tRPC adapter owns HTTP method rules; a GET cannot execute mutations.
    expect(
      (await fixture.rpc("projects.delete", { id: fixture.project.id })).status,
    ).toBe(405);
    expect((await fixture.rpc("system.health")).status).toBe(200);
    const internal = await fixture.request("/internal/execution/v1/unknown/");
    expect(internal.status).toBe(401);
  } finally {
    fixture.close();
  }
});

test("tRPC batches preserve query permissions and mutation CSRF enforcement", async () => {
  const fixture = rpcFixture();
  try {
    const batched = await fixture.request(
      "/trpc/projects.list,credentials.list?batch=1&input=%7B%7D",
    );
    expect(batched.status).toBe(200);
    const data = z
      .array(z.object({ result: z.object({ data: z.unknown() }) }))
      .parse(await batched.json());
    expect(data).toHaveLength(2);
    const request = new Request("http://localhost/trpc/projects.delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionid=rpc-test-session",
      },
      body: JSON.stringify({ id: fixture.project.id }),
    });
    const { createApp } = await import("../app");
    expect((await createApp(fixture.store)(request)).status).toBe(403);
  } finally {
    fixture.close();
  }
});
