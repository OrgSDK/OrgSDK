import { expect, test } from "bun:test";
import { z } from "zod";
import { createApp } from "../app";
import { openStore } from "../db";
import { users } from "../db/schema/core";
import { digest, encrypt } from "../shared/security";
import { setup, store } from "./core-fixture";

const studio = "https://studio.orgsdk.ai";
const endpoint = "http://localhost:28940";
const credentials = { email: setup.email, password: setup.password1 };

function request(
  path: string,
  input?: unknown,
  token?: string,
  origin = endpoint,
) {
  return new Request(origin + "/trpc/" + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      origin: studio,
      "content-type": "application/json",
      ...(token && { "x-orgsdk-studio-session": token }),
    },
    ...(input !== undefined && { body: JSON.stringify(input) }),
  });
}

async function sessionToken(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  return z
    .object({
      result: z.object({
        data: z.object({
          studioGrant: z.object({ token: z.string() }),
        }),
      }),
    })
    .parse(await response.json()).result.data.studioGrant.token;
}

test("local Studio sign-in survives restart and requires the correct origin, installation, MFA and a live session", async () => {
  let installation = store();
  try {
    let app = createApp(installation);
    expect((await app(request("auth.setup", setup))).status).toBe(200);
    expect(
      (
        await app(
          request("auth.login", { ...credentials, password: "incorrect" }),
        )
      ).status,
    ).toBe(400);
    const code = "fixture-recovery-code";
    installation.db
      .update(users)
      .set({
        totpSecret: encrypt(installation, "JBSWY3DPEHPK3PXP"),
        recoveryCodes: JSON.stringify([digest(code)]),
      })
      .run();
    const challenge = await sessionToken(
      await app(request("auth.login", credentials)),
    );
    expect(
      (await app(request("projects.list", undefined, challenge))).status,
    ).toBe(401);
    const token = await sessionToken(
      await app(request("auth.mfaAuthenticate", { code }, challenge)),
    );
    const directory = installation.dataDir;
    installation.close();
    installation = openStore(directory);
    app = createApp(installation);
    expect((await app(request("projects.list", undefined, token))).status).toBe(
      200,
    );
    expect(
      (
        await app(
          request("projects.list", undefined, token, "http://localhost:28941"),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app(
          new Request(endpoint + "/trpc/projects.list", {
            headers: { cookie: "sessionid=" + token },
          }),
        )
      ).status,
    ).toBe(401);
    const wrongOrigin = request("projects.list", undefined, token);
    wrongOrigin.headers.set("origin", "https://other.example.test");
    expect((await app(wrongOrigin)).status).toBe(401);
    expect((await app(request("auth.logout", {}, token))).status).toBe(200);
    expect((await app(request("projects.list", undefined, token))).status).toBe(
      401,
    );
  } finally {
    installation.close();
  }
});

test("hosted Studio connections require installation pairing", async () => {
  const installation = store();
  const remote = "https://workspace.example.test";
  const previous = {
    dashboard: process.env.ORGSDK_STUDIO_ORIGIN,
    public: process.env.ORGSDK_PUBLIC_ORIGIN,
  };
  try {
    process.env.ORGSDK_STUDIO_ORIGIN = studio;
    process.env.ORGSDK_PUBLIC_ORIGIN = remote;
    const app = createApp(installation);
    expect(
      (
        await app(
          request(
            "auth.setup",
            { ...setup, domain: "workspace.example.test" },
            undefined,
            remote,
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (await app(request("auth.login", credentials, undefined, remote))).status,
    ).toBe(401);
  } finally {
    if (previous.dashboard === undefined) {
      delete process.env.ORGSDK_STUDIO_ORIGIN;
    } else {
      process.env.ORGSDK_STUDIO_ORIGIN = previous.dashboard;
    }
    if (previous.public === undefined) {
      delete process.env.ORGSDK_PUBLIC_ORIGIN;
    } else {
      process.env.ORGSDK_PUBLIC_ORIGIN = previous.public;
    }
    installation.close();
  }
});
