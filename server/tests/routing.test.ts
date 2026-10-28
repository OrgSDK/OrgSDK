import { expect, test } from "bun:test";
import { fixture } from "./integration-fixture";

test("routing respects API boundaries, trailing slashes and shared errors", async () => {
  const f = await fixture();
  try {
    for (const path of ["/api/v1/projects/", "/api/v1/projects"]) {
      expect((await f.request(path)).status).toBe(200);
    }
    for (const path of ["/trpc-spoof", "/api/trpc-spoof", "/api/v1/unknown/"]) {
      expect((await f.request(path)).status).toBe(404);
    }
    expect(
      (await f.request("/api/v1/projects/invalid/unsupported/", "POST", {}))
        .status,
    ).toBe(405);
    const internal = await f.request("/internal/execution/v1/unknown/");
    expect(internal.status).toBe(401);
    expect(await internal.json()).toEqual({
      detail: "Execution credential required.",
    });
    const health = await f.request("/api/health/", "HEAD");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("");
  } finally {
    await f.close();
  }
});
