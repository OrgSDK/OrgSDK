import { expect, test } from "bun:test";
import { rpcFixture } from "./rpc-fixture";
import { newerStable } from "../platform/stable-release";
import { memberships } from "../db/schema";

test("updates accept only strictly newer stable versions", () => {
  expect(newerStable("2.10.0", "2.9.1")).toBe(true);
  for (const candidate of [
    "2.1.0",
    "1.99.99",
    "2.2.0-rc.1",
    "latest",
    "02.2.0",
    "../2.2.0",
    "2.3.0\n",
  ]) {
    expect(newerStable(candidate, "2.1.0")).toBe(false);
  }
});

test("a server without its launcher and non-owner clients cannot request installation changes", async () => {
  const fixture = rpcFixture();
  try {
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "latest" },
          "mutation",
        )
      ).status,
    ).toBe(400);
    const issued = await fixture.caller().tokens.create({
      name: "Update permission test",
      scopes: ["catalog:read"],
      projects: [fixture.project.id],
    });
    fixture.store.db.update(memberships).set({ role: "admin" }).run();
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fixture.rpc(
          "system.requestUpdate",
          { version: "2.2.0" },
          "mutation",
          issued.token,
        )
      ).status,
    ).toBe(403);
  } finally {
    fixture.close();
  }
});
