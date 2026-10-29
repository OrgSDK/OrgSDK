import { randomUUID } from "node:crypto";
import { plugins } from "../db/schema";
import { rpcFixture } from "./rpc-fixture";
export function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "csrftoken=test",
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      cookie,
      "x-csrftoken": "test",
      origin: "http://localhost",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export function fixture() {
  const fixture = rpcFixture();
  const store = fixture.store;
  const project = fixture.project.id;
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const digest = "a".repeat(64);
  const packageUrl = "https://example.com/plugin.tgz";
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
  return { ...fixture, cookie: "sessionid=rpc-test-session", id };
}
export function fakeFetch(
  fn: (address: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((address: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fn(String(address), init ?? {}))) as typeof fetch;
}
