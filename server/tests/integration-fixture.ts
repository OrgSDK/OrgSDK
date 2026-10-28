import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { openStore } from "../db";
export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-integration-"));
  const store = openStore(join(dir, "data"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createApp(store),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const cookies = new Map<string, string>();
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {
              cookie: [...cookies]
                .map(([key, value]) => `${key}=${value}`)
                .join("; "),
              "X-CSRFToken": cookies.get("csrftoken") ?? "",
              Origin: origin,
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!token)
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const index = pair!.indexOf("=");
        cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
      }
    return response;
  }
  async function json(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ): Promise<any> {
    const response = await request(path, method, body, token);
    const result = response.status === 204 ? null : await response.json();
    expect(response.status, JSON.stringify(result)).toBeLessThan(400);
    return result;
  }
  await json("/api/v1/setup/");
  await json("/api/v1/setup/", "POST", {
    domain: "127.0.0.1",
    workspace_name: "Test workspace",
    username: "owner",
    email: "owner@example.test",
    password1: "A-strong-test-password-123",
    password2: "A-strong-test-password-123",
    project_name: "First project",
  });
  await json("/api/auth/browser/v1/auth/login", "POST", {
    email: "owner@example.test",
    password: "A-strong-test-password-123",
  });
  const project = (await json("/api/v1/projects/")).results[0];
  async function register() {
    const registered = await json(
      `/api/v1/projects/${project.id}/executor/`,
      "POST",
      { locally_managed: false },
    );
    await json(
      "/internal/execution/v1/register/",
      "POST",
      {
        protocol_version: 3,
        capabilities: ["code", "action", "validate", "test"],
      },
      registered.token,
    );
    return registered.token as string;
  }
  return {
    dir,
    store,
    origin,
    request,
    json,
    project,
    register,
    async close() {
      await server.stop(true);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
