import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "../src/api/client.ts";

test("only first-run setup responses redirect to setup", async () => {
  const destinations = [];
  const originalLocation = globalThis.location;
  globalThis.location = {
    assign: (destination) => destinations.push(destination),
  };
  try {
    for (const [status, body] of [
      [503, { code: "setup_required" }],
      [503, { detail: "Service unavailable" }],
      [404, { detail: "Unregistered workspace domain." }],
      [200, { is_authenticated: false }],
    ]) {
      await api.GET("/api/v1/session/", {
        baseUrl: "http://localhost",
        fetch: async () => globalThis.Response.json(body, { status }),
      });
    }
    assert.deepEqual(destinations, ["/setup/"]);
  } finally {
    globalThis.location = originalLocation;
  }
});
