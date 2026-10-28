import { expect, test } from "bun:test";
import { fixture } from "./integration-fixture";
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
    await f.close();
  }
}, 15000);
