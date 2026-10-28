import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAuth } from "../auth/routes";
import { openStore } from "../db";
import { plugins } from "../db/schema";
import { createContext } from "../http/context";
export const config = {
  domain: "localhost",
  workspace_name: "Test",
  username: "owner",
  email: "owner@example.com",
  password1: "long strong password",
  password2: "long strong password",
};
export function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "csrftoken=test",
) {
  return new Request(`http://localhost:8080${path}`, {
    method,
    headers: {
      cookie,
      "x-csrftoken": "test",
      origin: "http://localhost:8080",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-oauth-"));
  const store = openStore(dir);
  await handleAuth(
    createContext(request("/api/v1/setup/", "POST", config), store),
  );
  const login = createContext(
    request("/api/auth/browser/v1/auth/login", "POST", {
      email: config.email,
      password: config.password1,
    }),
    store,
  );
  await handleAuth(login);
  const cookie = login.responseHeaders
    .getSetCookie()
    .find((x) => x.startsWith("sessionid="))!
    .split(";")[0]!;
  const project = (
    store.sqlite.query("SELECT id FROM projects").get() as { id: string }
  ).id;
  const id = randomUUID(),
    timestamp = new Date().toISOString(),
    digest = "a".repeat(64),
    packageUrl = "https://example.com/plugin.tgz";
  store.db
    .insert(plugins)
    .values({
      id,
      workspaceId: 1,
      projectId: project,
      slug: "test-plugin",
      version: "1",
      description: "test",
      source: "",
      digest,
      enabled: true,
      credentialId: null,
      configuration: {},
      releaseMetadata: {
        slug: "test-plugin",
        version: "1",
        digest,
        package_url: packageUrl,
        auth: { type: "oauth2", provider: "google-oauth", scopes: ["email"] },
      },
      packageUrl,
      distribution: "external",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return {
    store,
    cookie,
    id,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function fakeFetch(
  fn: (address: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((address: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fn(String(address), init ?? {}))) as typeof fetch;
}
