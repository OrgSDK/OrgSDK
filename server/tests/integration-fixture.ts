import { z } from "zod";
import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationServer } from "./integration-server";
import { openStore } from "../db";
import { pageSchema, projectSchema } from "./wire-schemas";

export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-integration-"));
  const store = openStore(join(dir, "data"));
  const server = await integrationServer(store, dir);
  const origin = server.origin;
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
    if (!token) {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0]!;
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
    return response;
  }
  async function json(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ): Promise<unknown> {
    const response = await request(path, method, body, token);
    const result: unknown =
      response.status === 204 ? null : await response.json();
    expect(response.status, JSON.stringify(result)).toBeLessThan(400);
    return result;
  }
  function rpc(
    path: string,
    input?: unknown,
    type: "query" | "mutation" = "query",
    token?: string,
  ) {
    const endpoint = `/trpc/${path}`;
    const url =
      type === "query" && input !== undefined
        ? `${endpoint}?input=${encodeURIComponent(JSON.stringify(input))}`
        : endpoint;
    return request(
      url,
      type === "query" ? "GET" : "POST",
      type === "mutation" ? input : undefined,
      token,
    );
  }
  async function data(
    path: string,
    input?: unknown,
    type: "query" | "mutation" = "query",
    token?: string,
  ): Promise<unknown> {
    const response = await rpc(path, input, type, token);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBeLessThan(400);
    return z
      .object({ result: z.object({ data: z.unknown().optional() }) })
      .parse(body).result.data;
  }
  await data("auth.setupStatus");
  await data(
    "auth.setup",
    {
      domain: "127.0.0.1",
      workspace_name: "Test workspace",
      username: "owner",
      email: "owner@example.test",
      password1: "A-strong-test-password-123",
      password2: "A-strong-test-password-123",
      project_name: "First project",
    },
    "mutation",
  );
  await data(
    "auth.login",
    { email: "owner@example.test", password: "A-strong-test-password-123" },
    "mutation",
  );
  const project = pageSchema(projectSchema).parse(await data("projects.list"))
    .results[0]!;
  async function register() {
    const registered = z
      .object({ token: z.string() })
      .parse(
        await data(
          "projects.connectExecutor",
          { id: project.id, locally_managed: false },
          "mutation",
        ),
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
    return registered.token;
  }
  return {
    dir,
    store,
    origin,
    request,
    json,
    rpc,
    data,
    project,
    register,
    async close() {
      await server.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
