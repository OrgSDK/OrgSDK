import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { openStore } from "./db";
import { createApp } from "./app";
import { maintenance } from "./execution";
import * as tables from "./db/domain";
import { jobSchema } from "../runtime/src/contract";

async function fixture() {
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
    close() {
      server.stop(true);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a separate existing executor process runs code against the Bun API", async () => {
  const f = await fixture();
  try {
    const token = await f.register();
    const run = await f.json("/api/v1/runs/", "POST", {
      project: f.project.id,
      operation: "code",
      source: "console.log('executed'); return 6 * 7;",
      inputs: {},
      idempotency_key: "real-worker",
    });
    const job = jobSchema.parse(
      await f.json("/internal/execution/v1/claim/", "POST", undefined, token),
    );
    expect(job.run_id).toBe(run.id);
    const process = Bun.spawn(
      [Bun.which("bun")!, resolve("runtime/src/worker.ts")],
      {
        cwd: resolve("runtime"),
        env: {
          PATH: globalThis.process.env.PATH!,
          DJANGO_URL: f.origin,
          EXECUTOR_AGENT_DIR: join(f.dir, "project"),
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    process.stdin.write(JSON.stringify(job));
    process.stdin.end();
    const timeout = setTimeout(() => process.kill(), 15000);
    const exit = await process.exited;
    clearTimeout(timeout);
    const errors = await new Response(process.stderr).text();
    expect(exit, errors).toBe(0);
    const result = await f.json(`/api/v1/runs/${run.id}/`);
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: 42 });
    const events = await f.json(`/api/v1/runs/${run.id}/events/`);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sequence).toBe(1);
  } finally {
    f.close();
  }
}, 30000);

test("run capabilities enforce serial claims, resource grants, redaction and expiry", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const document = await f.json("/api/v1/documents/", "POST", {
      title: "Allowed",
      kind: "document",
      content: "initial",
    });
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      writable_documents: [document.id],
    });
    const credential = await f.json("/api/v1/credentials/", "POST", {
      name: "Test credential",
      provider: "test",
      secret: { api_key: "synthetic-private-test-value" },
    });
    const run = await f.json("/api/v1/runs/", "POST", {
      project: f.project.id,
      operation: "code",
      source: "return 1;",
      idempotency_key: "capability",
    });
    const claim = await f.json(
      "/internal/execution/v1/claim/",
      "POST",
      undefined,
      worker,
    );
    expect(
      (
        await f.request(
          "/internal/execution/v1/claim/",
          "POST",
          undefined,
          worker,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await f.request(
          `/internal/execution/v1/credentials/${credential.id}/`,
          "GET",
          undefined,
          claim.capability,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          {
            operation: "write_document",
            document_id: document.id,
            content: "changed",
          },
          claim.capability,
        )
      ).status,
    ).toBe(200);
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      writable_documents: [],
    });
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "get_document", document_id: document.id },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    const second = await f.json("/api/v1/documents/", "POST", {
      title: "Added later",
      kind: "document",
      content: "secret",
    });
    await f.json(`/api/v1/projects/${f.project.id}/`, "PATCH", {
      readable_documents: [second.id],
    });
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "get_document", document_id: second.id },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    await f.json(
      `/internal/execution/v1/runs/${run.id}/events/`,
      "POST",
      {
        sequence: 1,
        kind: "log",
        data: { text: "synthetic-private-test-value" },
      },
      claim.capability,
    );
    expect(
      JSON.stringify(await f.json(`/api/v1/runs/${run.id}/events/`)),
    ).not.toContain("synthetic-private-test-value");
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${run.id}/events/`,
          "POST",
          { sequence: 1, kind: "log", data: { text: "different" } },
          claim.capability,
        )
      ).status,
    ).toBe(409);
    f.store.db
      .update(tables.runs)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(tables.runs.id, run.id))
      .run();
    maintenance(f.store);
    expect((await f.json(`/api/v1/runs/${run.id}/`)).status).toBe(
      "interrupted",
    );
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${run.id}/heartbeat/`,
          "POST",
          {},
          claim.capability,
        )
      ).status,
    ).toBe(401);
  } finally {
    f.close();
  }
}, 15000);

test("MCP and tRPC share persistence, reject unauthorized scopes and record client activity", async () => {
  const f = await fixture();
  try {
    const issued = await f.json("/api/v1/tokens/", "POST", {
      name: "Scoped client",
      scopes: ["catalog:read", "code:execute", "runs:read"],
      projects: [f.project.id],
      action_versions: [],
    });
    const call = (method: string, params: unknown = {}) =>
      f.json(
        "/mcp/",
        "POST",
        { jsonrpc: "2.0", id: 1, method, params },
        issued.token,
      );
    const list = await call("tools/list");
    expect(
      list.result.tools.some((tool: any) => tool.name === "execute_code"),
    ).toBe(true);
    expect(
      list.result.tools.some((tool: any) => tool.name === "save_action"),
    ).toBe(false);
    const execute = await call("tools/call", {
      name: "execute_code",
      arguments: {
        project: f.project.id,
        source: "return 1;",
        idempotency_key: "mcp-code",
      },
    });
    expect(execute.result.isError).toBe(false);
    const runId = JSON.parse(execute.result.content[0].text).id;
    const result = await call("tools/call", {
      name: "get_run",
      arguments: { id: runId },
    });
    expect(JSON.parse(result.result.content[0].text).id).toBe(runId);
    expect(
      (
        await f.request(
          "/mcp/",
          "POST",
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "save_action",
              arguments: { name: "Denied", source: "return 1;" },
            },
          },
          issued.token,
        )
      ).status,
    ).toBe(403);
    const activity = (await f.json("/api/v1/tokens/")).results.find(
      (token: any) => token.id === issued.id,
    );
    expect(activity.request_count).toBe(4);
    expect(activity.error_count).toBe(1);
    expect(activity.mcp_request_count).toBe(4);
    expect(
      (await f.request("/api/v1/session/", "GET", undefined, issued.token))
        .status,
    ).toBe(403);
    expect(
      (await f.request("/trpc/session", "GET", undefined, issued.token)).status,
    ).toBe(403);
    const trpc = await f.json("/trpc/projects.list");
    expect(trpc.result.data.results[0].id).toBe(f.project.id);
    const denied = await fetch(`${f.origin}/trpc/projects.list`);
    expect(denied.status).toBe(401);
  } finally {
    f.close();
  }
}, 15000);

test("isolated protocol-three jobs cannot access project data and executor replacement revokes leases", async () => {
  const f = await fixture();
  try {
    const worker = await f.register();
    const validation = await f.json("/api/v1/actions/validate-code/", "POST", {
      project: f.project.id,
      source: "return 1;",
      idempotency_key: "isolated",
    });
    const claim = jobSchema.parse(
      await f.json("/internal/execution/v1/claim/", "POST", undefined, worker),
    );
    expect(claim.protocol_version).toBe(3);
    expect(claim.snapshot.agents[0]!.plugins).toEqual([]);
    expect(
      (
        await f.request(
          "/internal/execution/v1/product/project-data/",
          "POST",
          { operation: "list_documents" },
          claim.capability,
        )
      ).status,
    ).toBe(403);
    await f.json(`/api/v1/projects/${f.project.id}/executor/`, "DELETE");
    expect(
      (
        await f.request(
          `/internal/execution/v1/runs/${validation.id}/heartbeat/`,
          "POST",
          {},
          claim.capability,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await f.request(
          "/internal/execution/v1/claim/",
          "POST",
          undefined,
          worker,
        )
      ).status,
    ).toBe(401);
    expect((await f.json(`/api/v1/projects/${f.project.id}/`)).id).toBe(
      f.project.id,
    );
  } finally {
    f.close();
  }
}, 15000);
