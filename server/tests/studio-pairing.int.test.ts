import { expect, test } from "bun:test";
import { z } from "zod";
import { createApp } from "../app";
import { digest, randomSecret } from "../shared/security";
import { rpcFixture } from "./rpc-fixture";
import { studioAudience } from "../auth/studio";

test("dashboard approval is single use, origin and installation bound, and ends at logout", async () => {
  const previous = process.env.ORGSDK_STUDIO_ORIGIN;
  const dashboard = "https://studio.example.test";
  const owner = rpcFixture();
  const other = rpcFixture();
  process.env.ORGSDK_STUDIO_ORIGIN = dashboard;
  try {
    const verifier = digest(randomSecret());
    const { code } = await owner
      .caller()
      .studio.approve({ challenge: digest(verifier) });
    const app = createApp(owner.store);
    const exchange = (proof: string) =>
      app(
        new Request("http://localhost/trpc/studio.exchange", {
          method: "POST",
          headers: { origin: dashboard, "content-type": "application/json" },
          body: JSON.stringify({ code, verifier: proof }),
        }),
      );
    expect((await exchange(digest("other tab"))).status).toBe(403);
    const response = await exchange(verifier);
    expect(response.headers.get("access-control-allow-origin")).toBe(dashboard);
    const {
      result: {
        data: { token },
      },
    } = z
      .object({ result: z.object({ data: z.object({ token: z.string() }) }) })
      .parse(await response.json());
    expect((await exchange(verifier)).status).toBe(403);
    const read = (origin = dashboard, host = "localhost") =>
      new Request("http://" + host + "/trpc/projects.list", {
        headers: { origin, "x-orgsdk-studio-session": token },
      });
    expect((await app(read())).status).toBe(200);
    expect(
      (await app(read("https://untrusted.example.test"))).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
    expect((await app(read("https://untrusted.example.test"))).status).toBe(
      401,
    );
    expect(
      (await app(read(dashboard, "unregistered.example.test"))).status,
    ).toBe(401);
    expect((await createApp(other.store)(read())).status).toBe(401);
    expect(
      (
        await app(
          new Request("http://localhost/trpc/auth.setupStatus", {
            headers: { origin: dashboard, cookie: "sessionid=unused" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app(
          new Request("http://localhost/trpc/studio.approve", {
            method: "POST",
            headers: {
              origin: dashboard,
              "x-orgsdk-studio-session": token,
              "content-type": "application/json",
            },
            body: JSON.stringify({ challenge: digest(verifier) }),
          }),
        )
      ).status,
    ).toBe(403);
    await owner.caller().auth.logout();
    expect((await app(read())).status).toBe(401);
  } finally {
    if (previous === undefined) {
      delete process.env.ORGSDK_STUDIO_ORIGIN;
    } else {
      process.env.ORGSDK_STUDIO_ORIGIN = previous;
    }
    owner.close();
    other.close();
  }
});

test("remote installations require an exact configured HTTPS origin", () => {
  const priorDashboard = process.env.ORGSDK_STUDIO_ORIGIN;
  const priorPublic = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_STUDIO_ORIGIN = "https://studio.example.test";
  process.env.ORGSDK_PUBLIC_ORIGIN = "https://customer.example.test";
  try {
    expect(studioAudience("https://customer.example.test")).toBe(
      "https://studio.example.test",
    );
    expect(studioAudience("http://customer.example.test")).toBeUndefined();
    expect(studioAudience("https://other.example.test")).toBeUndefined();
  } finally {
    if (priorDashboard === undefined) {
      delete process.env.ORGSDK_STUDIO_ORIGIN;
    } else {
      process.env.ORGSDK_STUDIO_ORIGIN = priorDashboard;
    }
    if (priorPublic === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = priorPublic;
    }
  }
});
