import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { openStore } from "./db";
import { publicRequest } from "./origin";

const setup = {
  domain: "workspace.example",
  workspace_name: "Example",
  username: "owner",
  email: "owner@example.com",
  password1: "strong test password",
  password2: "strong test password",
};
test("configured HTTPS origin controls CSRF, workspace host and secure cookies behind a proxy", async () => {
  const prior = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "https://workspace.example";
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-origin-"));
  const store = openStore(dir);
  try {
    const app = createApp(store);
    const first = await app(
      new Request("http://workspace.example/api/v1/setup/"),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).hostname).toBe("workspace.example");
    const csrf = first.headers
      .getSetCookie()
      .find((value) => value.startsWith("csrftoken="))!;
    expect(csrf).toContain("; Secure");
    const token = csrf.split(";")[0]!.slice("csrftoken=".length);
    const headers = {
      cookie: `csrftoken=${token}`,
      "x-csrftoken": token,
      origin: "https://workspace.example",
      "content-type": "application/json",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
    };
    const complete = await app(
      new Request("http://workspace.example/api/v1/setup/", {
        method: "POST",
        headers,
        body: JSON.stringify(setup),
      }),
    );
    expect(complete.status).toBe(201);
    const login = await app(
      new Request("http://workspace.example/api/auth/browser/v1/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: setup.email, password: setup.password1 }),
      }),
    );
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    expect(cookies.find((value) => value.startsWith("sessionid="))).toContain(
      "; Secure",
    );
    expect(cookies.find((value) => value.startsWith("sessionid="))).toContain(
      "; HttpOnly",
    );
    const badOrigin = await app(
      new Request("http://workspace.example/api/auth/browser/v1/auth/login", {
        method: "POST",
        headers: { ...headers, origin: "https://attacker.example" },
        body: JSON.stringify({ email: setup.email, password: setup.password1 }),
      }),
    );
    expect(badOrigin.status).toBe(403);
    const wrongScheme = await app(
      new Request("http://workspace.example/api/auth/browser/v1/auth/login", {
        method: "POST",
        headers: {
          ...headers,
          origin: "http://workspace.example",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ email: setup.email, password: setup.password1 }),
      }),
    );
    expect(wrongScheme.status).toBe(403);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (prior === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = prior;
  }
});
test("configured origin rejects host mismatches and ignores forged forwarding headers", async () => {
  const prior = process.env.ORGSDK_PUBLIC_ORIGIN;
  process.env.ORGSDK_PUBLIC_ORIGIN = "https://workspace.example";
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-origin-"));
  const store = openStore(dir);
  try {
    const app = createApp(store);
    const spoof = await app(
      new Request("http://attacker.example/api/v1/session/", {
        headers: {
          "x-forwarded-host": "workspace.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(spoof.status).toBe(400);
    const normalized = publicRequest(
      new Request("http://workspace.example/test", {
        headers: {
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
        },
      }),
    );
    expect(normalized.url).toBe("https://workspace.example/test");
    const health = await app(new Request("http://127.0.0.1/api/health/"));
    expect(health.status).toBe(200);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (prior === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = prior;
  }
});
test("without public origin direct HTTP remains HTTP and forwarding headers have no effect", async () => {
  const prior = process.env.ORGSDK_PUBLIC_ORIGIN;
  delete process.env.ORGSDK_PUBLIC_ORIGIN;
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-origin-"));
  const store = openStore(dir);
  try {
    const app = createApp(store);
    const response = await app(
      new Request("http://localhost:8080/api/v1/setup/", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "attacker.example",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).hostname).toBe("localhost");
    expect(
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("csrftoken=")),
    ).not.toContain("; Secure");
    expect(publicRequest(new Request("http://localhost:8080/path")).url).toBe(
      "http://localhost:8080/path",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (prior === undefined) delete process.env.ORGSDK_PUBLIC_ORIGIN;
    else process.env.ORGSDK_PUBLIC_ORIGIN = prior;
  }
});
